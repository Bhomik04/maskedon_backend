import Razorpay from "razorpay";
import { logger } from "./logger";

/** Returns a configured Razorpay SDK instance. Throws if env vars are missing. */
export function getRazorpayInstance(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment");
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Issues a Razorpay refund for a given payment.
 * @param razorpayPaymentId — The `pay_*` ID from Razorpay
 * @param amountPaisa — Amount to refund in paisa (0 = skip refund)
 * @returns The Razorpay refund ID (e.g. `rfnd_*`), or null if amount is 0
 */
export async function issueRefund(
  razorpayPaymentId: string,
  amountPaisa: number,
  idempotencyKey?: string
): Promise<string | null> {
  if (amountPaisa <= 0) return null;

  const razorpay = getRazorpayInstance();
  const refund = await razorpay.payments.refund(razorpayPaymentId, {
    amount: amountPaisa,
    speed: "normal",
    notes: {
      source: "maskedon_auto_refund",
      idempotency_key: idempotencyKey ?? razorpayPaymentId,
    },
  }) as { id: string };

  logger.info("Razorpay refund issued", {
    razorpayPaymentId,
    amountPaisa,
    refundId: refund.id,
  });

  return refund.id;
}
