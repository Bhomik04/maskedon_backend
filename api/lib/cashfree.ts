/**
 * Cashfree Payments API client for maskedon.
 *
 * Uses x-client-id / x-client-secret header authentication.
 * API version: 2023-08-01
 *
 * Column mapping (re-uses existing Razorpay column names in payments table):
 *   razorpay_order_id    → Cashfree order_id  (our generated ID, e.g. "mskd<uuid32>")
 *   razorpay_payment_id  → Cashfree cf_payment_id
 *   razorpay_signature   → sentinel "cashfree_verified" | "cashfree_webhook_verified"
 *
 * To switch gateway: swap this lib + controller callers. No DB migration needed.
 */

import { logger } from "./logger";

const PRODUCTION_BASE = "https://api.cashfree.com/pg";
const SANDBOX_BASE    = "https://sandbox.cashfree.com/pg";
const API_VERSION     = "2023-08-01";

function getBaseUrl(): string {
  return process.env.CASHFREE_SANDBOX === "true" ? SANDBOX_BASE : PRODUCTION_BASE;
}

function getHeaders(): Record<string, string> {
  const appId     = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  if (!appId || !secretKey) {
    throw new Error("CASHFREE_APP_ID and CASHFREE_SECRET_KEY must be set");
  }
  return {
    "x-api-version":  API_VERSION,
    "x-client-id":    appId,
    "x-client-secret": secretKey,
    "Content-Type":   "application/json",
  };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CashfreeOrderResult {
  order_id:          string;
  payment_session_id: string;
  order_status:      string;
  order_amount:      number;
}

export interface CashfreePayment {
  cf_payment_id:    string | number;
  payment_status:   string;
  payment_amount:   number;
}

// ── Create order ─────────────────────────────────────────────────────────────

/**
 * Creates a Cashfree payment order.
 * @param orderId     Our unique order ID (alphanumeric, max 50 chars)
 * @param amountPaisa Amount in paisa — converted to rupees for Cashfree
 * @param purpose     Short description (order note)
 * @param buyerName   Customer display name
 * @param email       Customer email
 * @param returnUrl   URL after payment; Cashfree appends ?order_id={order_id}
 * @param notifyUrl   Optional server-side webhook URL for this order (belt-and-suspenders fallback)
 */
export async function createOrder(options: {
  orderId:     string;
  amountPaisa: number;
  purpose:     string;
  buyerName:   string;
  email:       string;
  returnUrl:   string;
  notifyUrl?:  string;
}): Promise<CashfreeOrderResult> {
  const amountRupees = parseFloat((options.amountPaisa / 100).toFixed(2));

  const body = {
    order_id:       options.orderId,
    order_amount:   amountRupees,
    order_currency: "INR",
    order_note:     options.purpose.slice(0, 500),
    customer_details: {
      customer_id:    options.orderId,
      customer_name:  (options.buyerName || "Guest").slice(0, 100),
      customer_email: options.email || "team@maskedon.com",
      customer_phone: "9999999999", // Cashfree requires this field; we don't collect phone yet
    },
    order_meta: {
      return_url: options.returnUrl,
      ...(options.notifyUrl ? { notify_url: options.notifyUrl } : {}),
    },
  };

  const response = await fetch(`${getBaseUrl()}/orders`, {
    method:  "POST",
    headers: getHeaders(),
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Cashfree createOrder failed", { status: response.status, body: text });
    throw new Error(`Cashfree order creation failed (${response.status}): ${text}`);
  }

  const data = await response.json() as CashfreeOrderResult;
  return data;
}

// ── Fetch order (server-side verify) ─────────────────────────────────────────

/**
 * Fetches a Cashfree order by ID.
 * Returns order_status: "PAID" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "TERMINATION"
 */
export async function getOrder(orderId: string): Promise<CashfreeOrderResult> {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method:  "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Cashfree getOrder failed", { orderId, status: response.status, body: text });
    throw new Error(`Cashfree order fetch failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<CashfreeOrderResult>;
}

// ── Fetch order payments (to get cf_payment_id) ───────────────────────────────

/**
 * Fetches payments attached to a Cashfree order.
 * Used to retrieve cf_payment_id after a successful payment.
 */
export async function getOrderPayments(orderId: string): Promise<CashfreePayment[]> {
  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/payments`, {
    method:  "GET",
    headers: getHeaders(),
  });

  if (!response.ok) {
    logger.warn("Cashfree getOrderPayments failed", { orderId, status: response.status });
    return [];
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as CashfreePayment[]) : [];
}

// ── Refund order ─────────────────────────────────────────────────────────────

export interface CashfreeRefundResult {
  refund_id: string;
  cf_refund_id: string;
  refund_status: string;
  refund_amount: number;
}

/**
 * Initiates a refund for an order via Cashfree.
 * @param orderId     The Cashfree order_id
 * @param options.refundId Our unique refund ID
 * @param options.amount Refund amount in paisa (divided by 100 for rupees)
 * @param options.note   Optional description of the refund
 */
export async function refundOrder(
  orderId: string,
  options: {
    refundId: string;
    amount: number;
    note?: string;
  }
): Promise<CashfreeRefundResult> {
  const amountRupees = parseFloat((options.amount / 100).toFixed(2));

  if (process.env.CASHFREE_SANDBOX === "true" && process.env.CASHFREE_SIMULATE_REFUNDS !== "false") {
    logger.info("Simulating Cashfree Sandbox Refund", {
      orderId,
      refundId: options.refundId,
      amountRupees,
    });
    return {
      refund_id: options.refundId,
      cf_refund_id: `cf_ref_${Math.random().toString(36).substring(2, 12)}`,
      refund_status: "SUCCESS",
      refund_amount: amountRupees,
    };
  }

  const body = {
    refund_amount: amountRupees,
    refund_id:     options.refundId,
    refund_note:   options.note ?? "maskedon ticket refund",
    refund_speed:  "STANDARD",
  };

  const response = await fetch(`${getBaseUrl()}/orders/${encodeURIComponent(orderId)}/refunds`, {
    method:  "POST",
    headers: getHeaders(),
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Cashfree refund failed", { orderId, status: response.status, body: text });
    throw new Error(`Cashfree refund failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<CashfreeRefundResult>;
}

export interface CashfreeTransferResult {
  transfer_id: string;
  cf_transfer_id: string;
  status: string;
  message?: string;
}

/**
 * Calls Cashfree's Direct Transfer Payout API.
 * In Sandbox or Test Mode, if we don't have separate Payout credentials, we simulate a successful payout.
 */
export async function transferPayout(options: {
  transferId: string;
  amount: number; // in paisa
  bankAccount: string;
  ifsc: string;
  name: string;
}): Promise<CashfreeTransferResult> {
  const amountRupees = parseFloat((options.amount / 100).toFixed(2));
  
  if (process.env.CASHFREE_SANDBOX === "true" && process.env.CASHFREE_SIMULATE_PAYOUTS !== "false") {
    logger.info("Simulating Cashfree Sandbox Host Payout Transfer", {
      transferId: options.transferId,
      amountRupees,
      bankAccount: options.bankAccount.slice(-4).padStart(options.bankAccount.length, "*"),
      ifsc: options.ifsc,
    });
    return {
      transfer_id: options.transferId,
      cf_transfer_id: `cf_tx_${Math.random().toString(36).substring(2, 12)}`,
      status: "SUCCESS",
    };
  }

  const body = {
    beneId: options.transferId,
    amount: amountRupees,
    transferMode: "banktransfer",
    transferId: options.transferId,
    beneDetails: {
      phone: "9999999999",
      name: options.name,
      bankAccount: options.bankAccount,
      ifsc: options.ifsc,
    }
  };

  const response = await fetch(`${process.env.CASHFREE_SANDBOX === "true" ? "https://payout-api.sandbox.cashfree.com" : "https://payout-api.cashfree.com"}/payout/v1/directTransfer`, {
    method: "POST",
    headers: {
      "x-client-id": process.env.CASHFREE_APP_ID || "",
      "x-client-secret": process.env.CASHFREE_SECRET_KEY || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn("Cashfree Payout API call failed, falling back to Sandbox simulation", { status: response.status, body: text });
    if (process.env.CASHFREE_SANDBOX === "true") {
      return {
        transfer_id: options.transferId,
        cf_transfer_id: `cf_tx_fallback_${Math.random().toString(36).substring(2, 12)}`,
        status: "SUCCESS",
      };
    }
    throw new Error(`Cashfree payout transfer failed: ${text}`);
  }

  const data = await response.json() as any;
  if (data.status === "FAILED") {
    throw new Error(`Cashfree Payout transfer failed: ${data.message}`);
  }
  return {
    transfer_id: data.data.transferId,
    cf_transfer_id: data.data.referenceId,
    status: data.status,
  };
}

export interface EasySplitVendorResult {
  vendor_id: string;
  status: string;
  name: string;
}

export async function createEasySplitVendor(options: {
  vendorId: string;
  name: string;
  email: string;
  phone: string;
  bankAccount: string;
  ifsc: string;
  holderName: string;
}): Promise<EasySplitVendorResult> {
  if (process.env.CASHFREE_SANDBOX === "true" && process.env.CASHFREE_SIMULATE_PAYOUTS !== "false") {
    logger.info("Simulating Cashfree Easy Split Vendor Creation", {
      vendorId: options.vendorId,
      name: options.name,
      bankAccount: options.bankAccount.slice(-4).padStart(options.bankAccount.length, "*"),
    });
    return {
      vendor_id: options.vendorId,
      status: "ACTIVE",
      name: options.name,
    };
  }

  const body = {
    vendor_id: options.vendorId,
    status: "ACTIVE",
    name: options.name,
    email: options.email || "team@maskedon.com",
    phone: options.phone || "9999999999",
    verify_account: false,
    bank: {
      account_number: options.bankAccount,
      ifsc: options.ifsc,
      holder_name: options.holderName,
    }
  };

  const response = await fetch(`${getBaseUrl()}/easy-split/vendors`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Cashfree createEasySplitVendor failed", { status: response.status, body: text });
    throw new Error(`Cashfree vendor creation failed: ${text}`);
  }

  return response.json() as Promise<EasySplitVendorResult>;
}

export interface CashfreeSplitResult {
  success: boolean;
  message?: string;
}

export async function splitOrderAfterPayment(options: {
  orderId: string;
  vendorId: string;
  amountPaisa: number;
}): Promise<CashfreeSplitResult> {
  const amountRupees = parseFloat((options.amountPaisa / 100).toFixed(2));

  if (process.env.CASHFREE_SANDBOX === "true" && process.env.CASHFREE_SIMULATE_PAYOUTS !== "false") {
    logger.info("Simulating Cashfree Easy Split Order Split", {
      orderId: options.orderId,
      vendorId: options.vendorId,
      amountRupees,
    });
    return {
      success: true,
      message: "Split simulated successfully",
    };
  }

  const body = {
    split: [
      {
        vendor_id: options.vendorId,
        amount: amountRupees,
      }
    ],
    disable_split: false
  };

  const response = await fetch(`${getBaseUrl()}/easy-split/orders/${encodeURIComponent(options.orderId)}/split`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Cashfree splitOrderAfterPayment failed", { orderId: options.orderId, status: response.status, body: text });
    throw new Error(`Cashfree order splitting failed: ${text}`);
  }

  return { success: true };
}


