import { refundOrder, createEasySplitVendor, splitOrderAfterPayment } from "./cashfree";
import { logger } from "./logger";
import { query } from "../../dblayer/connection";
import {
  buildRetryAt,
  enqueueHostPayoutForEvent,
  findDueHostPayouts,
  findDueRefundJobs,
  getCompletedEventIdsWithoutPayouts,
  markHostPayoutFailed,
  markHostPayoutPaid,
  markHostPayoutProcessing,
  markHostPayoutRetry,
  markRefundJobFailed,
  markRefundJobProcessing,
  markRefundJobRetry,
  markRefundJobSucceeded,
} from "../../dblayer/financial-ops";
import { markPaymentRefundedWithDetails } from "../../dblayer/payment-queries";

const MAX_REFUND_ATTEMPTS = 5;
const MAX_PAYOUT_ATTEMPTS = 5;

export async function processRefundJobs(): Promise<number> {
  const jobs = await findDueRefundJobs(10);
  let processed = 0;

  for (const job of jobs) {
    processed += 1;
    await markRefundJobProcessing(job.id);

    try {
      const orderId = job.payment_razorpay_order_id;
      if (!orderId) {
        throw new Error(`No Cashfree order_id found for payment ${job.payment_id}`);
      }

      const refundResult = await refundOrder(orderId, {
        refundId: job.id,
        amount: Number(job.refund_amount || 0),
        note: `Refund for Event cancellation / Guest request`,
      });

      const providerRefundId = refundResult.cf_refund_id;

      await markRefundJobSucceeded(job.id, providerRefundId);
      await markPaymentRefundedWithDetails(
        job.payment_id,
        providerRefundId,
        Number(job.refund_amount || 0),
        Number(job.refund_amount || 0) >= Number(job.payment_amount || 0) ? "refunded" : "partial_refund"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refund processing failed";
      logger.warn("Refund job failed", { refundJobId: job.id, paymentId: job.payment_id, error: message });

      if (job.attempt_count + 1 >= MAX_REFUND_ATTEMPTS) {
        await markRefundJobFailed(job.id, message);
        await markPaymentRefundedWithDetails(job.payment_id, null, Number(job.refund_amount || 0), "refund_failed");
        continue;
      }

      await markRefundJobRetry(job.id, message, buildRetryAt(job.attempt_count + 1));
    }
  }

  return processed;
}

export async function ensureHostPayoutRecords(): Promise<number> {
  const events = await getCompletedEventIdsWithoutPayouts(25);
  let created = 0;

  for (const event of events) {
    const payout = await enqueueHostPayoutForEvent(event.id);
    if (payout) {
      created += 1;
    }
  }

  return created;
}

export async function executeHostPayoutTransfer(payout: {
  id: string;
  host_id: string;
  net_amount: number;
}): Promise<string> {
  // 1. Fetch bank account details from approved KYC verification
  const bankResult = await query<{ bank_account_number: string; bank_ifsc: string; bank_account_name: string }>(
    `SELECT bank_account_number, bank_ifsc, bank_account_name
     FROM host_verifications
     WHERE user_id = ? AND status = 'approved'`,
    [payout.host_id]
  );
  const bank = bankResult.rows[0];
  if (!bank || !bank.bank_account_number || !bank.bank_ifsc) {
    throw new Error("Host does not have approved KYC bank details");
  }

  // 2. Fetch host profile details for vendor registration
  const userResult = await query<{ email: string; display_name: string }>(
    "SELECT email, display_name FROM users WHERE id = ?",
    [payout.host_id]
  );
  const user = userResult.rows[0];
  const email = user?.email || "team@maskedon.com";
  const name = bank.bank_account_name || user?.display_name || "Host";

  const vendorId = `host_${payout.host_id.replace(/-/g, "_")}`;

  // 3. Register/Onboard Host as Vendor in Cashfree Easy Split
  try {
    await createEasySplitVendor({
      vendorId,
      name,
      email,
      phone: "9999999999", // Mandatory field in Cashfree
      bankAccount: bank.bank_account_number,
      ifsc: bank.bank_ifsc,
      holderName: name,
    });
  } catch (err: any) {
    logger.info(`Host vendor registration status details: ${err.message}`);
  }

  // 4. Retrieve payout ticket items and split them
  const itemsResult = await query<{ net_amount: number; razorpay_order_id: string }>(
    `SELECT hpi.net_amount, pay.razorpay_order_id
     FROM host_payout_items hpi
     JOIN payments pay ON pay.id = hpi.payment_id
     WHERE hpi.host_payout_id = ? AND pay.status = 'completed'`,
    [payout.id]
  );
  const items = itemsResult.rows;

  if (items.length === 0) {
    throw new Error("No completed payments found for this payout");
  }

  // 5. Fire split after payment API requests
  for (const item of items) {
    if (!item.razorpay_order_id) {
      logger.warn(`Payout item payment does not have a Cashfree order ID: payment_id: ${payout.id}`);
      continue;
    }
    await splitOrderAfterPayment({
      orderId: item.razorpay_order_id,
      vendorId,
      amountPaisa: item.net_amount,
    });
  }

  return `cf_split_${payout.id.replace(/-/g, "_")}`;
}

export async function processHostPayouts(): Promise<number> {
  const settingsResult = await query("SELECT value FROM platform_settings WHERE key = 'auto_settlements_enabled'");
  const autoEnabled = settingsResult.rows[0]?.value !== "false";
  if (!autoEnabled) {
    return 0;
  }

  const payouts = await findDueHostPayouts(10);
  let processed = 0;

  for (const payout of payouts) {
    processed += 1;
    await markHostPayoutProcessing(payout.id);

    try {
      const transferId = await executeHostPayoutTransfer(payout);
      await markHostPayoutPaid(payout.id, transferId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payout processing failed";
      logger.warn("Host payout job failed", { payoutId: payout.id, eventId: payout.event_id, error: message });

      if (payout.attempt_count + 1 >= MAX_PAYOUT_ATTEMPTS) {
        await markHostPayoutFailed(payout.id, message);
        continue;
      }

      await markHostPayoutRetry(payout.id, message, buildRetryAt(payout.attempt_count + 1));
    }
  }

  return processed;
}

export async function runFinancialWorkers(): Promise<void> {
  try {
    await ensureHostPayoutRecords();
    await processHostPayouts();
    await processRefundJobs();
  } catch (error) {
    logger.warn("Financial worker pass failed", error);
  }
}
