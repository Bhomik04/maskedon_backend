/**
 * Instamojo v2 API client for maskedon.
 *
 * Uses Application-Based Authentication (client_credentials OAuth).
 * Access tokens are cached in memory and refreshed on expiry.
 *
 * Column mapping (re-uses Razorpay column names in payments table):
 *   razorpay_order_id    → Instamojo payment_request_id
 *   razorpay_payment_id  → Instamojo payment_id
 *   razorpay_signature   → sentinel "instamojo_verified" or "instamojo_webhook_verified"
 *
 * To switch back to Razorpay: swap this lib + the controller callers.
 * DB columns don't need a migration.
 */

import { logger } from "./logger";

const PRODUCTION_BASE = "https://api.instamojo.com";
const SANDBOX_BASE = "https://test.instamojo.com";

function getBaseUrl(): string {
  return process.env.INSTAMOJO_SANDBOX === "true" ? SANDBOX_BASE : PRODUCTION_BASE;
}

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Unix ms

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.INSTAMOJO_CLIENT_ID;
  const clientSecret = process.env.INSTAMOJO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("INSTAMOJO_CLIENT_ID and INSTAMOJO_CLIENT_SECRET must be set");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${getBaseUrl()}/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instamojo token fetch failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  logger.info("Instamojo access token refreshed");
  return cachedToken;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface InstamojoPaymentRequest {
  id: string;
  longurl: string;
  status: string;
  amount: string;
  purpose: string;
}

export interface InstamojoPayment {
  payment_id: string;
  status: string;
  amount: string;
  currency: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

/**
 * Creates an Instamojo payment request.
 * @param amountPaisa  Internal price in paisa (÷100 for rupees sent to Instamojo).
 * @param purpose      Short description shown to payer.
 * @param buyerName    Pre-filled buyer name.
 * @param email        Pre-filled buyer email.
 * @param redirectUrl  URL Instamojo appends payment_request_id / payment_id / payment_status to.
 * @param webhookUrl   Optional webhook URL (per-request override). Prefer the account-level webhook.
 */
export async function createPaymentRequest(options: {
  amountPaisa: number;
  purpose: string;
  buyerName: string;
  email: string;
  redirectUrl: string;
  webhookUrl?: string;
}): Promise<InstamojoPaymentRequest> {
  const amountRupees = (options.amountPaisa / 100).toFixed(2);

  const params = new URLSearchParams({
    purpose: options.purpose.slice(0, 255), // Instamojo max
    amount: amountRupees,
    buyer_name: options.buyerName || "Guest",
    email: options.email || "noreply@maskedon.com",
    redirect_url: options.redirectUrl,
    send_email: "False",
    send_sms: "False",
    allow_repeated_payments: "False",
  });

  if (options.webhookUrl) {
    params.set("webhook", options.webhookUrl);
  }

  const response = await fetch(`${getBaseUrl()}/v2/payment_requests/`, {
    method: "POST",
    headers: {
      ...(await authHeader()),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json() as {
    success: boolean;
    payment_request?: InstamojoPaymentRequest;
    message?: unknown;
  };

  if (!response.ok || !data.success || !data.payment_request) {
    const msg = JSON.stringify(data.message ?? "Unknown error");
    logger.error("Instamojo createPaymentRequest failed", { status: response.status, message: msg });
    throw new Error(`Instamojo payment request creation failed: ${msg}`);
  }

  return data.payment_request;
}

/**
 * Fetches an existing payment request by ID.
 * Used to retrieve the longurl for idempotent retries.
 */
export async function fetchPaymentRequest(paymentRequestId: string): Promise<InstamojoPaymentRequest> {
  const response = await fetch(`${getBaseUrl()}/v2/payment_requests/${paymentRequestId}/`, {
    headers: await authHeader(),
  });

  const data = await response.json() as {
    success: boolean;
    payment_request?: InstamojoPaymentRequest;
  };

  if (!response.ok || !data.success || !data.payment_request) {
    throw new Error(`Failed to fetch Instamojo payment request ${paymentRequestId}`);
  }

  return data.payment_request;
}

/**
 * Verifies that a payment is "Credit" (successful).
 * Called after the user returns from Instamojo checkout.
 * @throws if the API call fails or status is not "Credit"
 */
export async function verifyPayment(
  paymentRequestId: string,
  paymentId: string
): Promise<InstamojoPayment> {
  const response = await fetch(
    `${getBaseUrl()}/v2/payment_requests/${paymentRequestId}/payments/${paymentId}/`,
    { headers: await authHeader() }
  );

  const data = await response.json() as {
    success: boolean;
    payment?: InstamojoPayment;
    message?: unknown;
  };

  if (!response.ok || !data.success || !data.payment) {
    const msg = JSON.stringify(data.message ?? "Unknown error");
    throw new Error(`Instamojo payment fetch failed: ${msg}`);
  }

  if (data.payment.status !== "Credit") {
    throw new Error(`Payment status is "${data.payment.status}", expected "Credit"`);
  }

  return data.payment;
}
