/**
 * maskedon Fee Calculator
 *
 * All amounts are in PAISA (₹1 = 100 paisa).
 *
 * Revenue model:
 *  - Host commission (default 12.5%): deducted from ticket price at payout
 *  - User platform fee (tiered): added ON TOP of ticket price at checkout
 *      ≤ ₹1000  → 6%
 *      ₹1001–₹1999 → 5.5%
 *      ≥ ₹2000  → 5%
 *  - Deposit: 10% of 1 ticket price, paid by host when creating a paid event.
 *    Returned during host payout after event completion.
 */

export const DEFAULT_HOST_COMMISSION_RATE = 12.5; // percent

export function getUserFeeRate(ticketPriceInPaisa: number): number {
  if (ticketPriceInPaisa === 0) return 0;
  if (ticketPriceInPaisa < 10000) {
    return 600 / ticketPriceInPaisa;
  }
  return 0.06;
}

/**
 * Returns the platform fee charged to the user for a ticket (in paisa).
 */
export function calculateUserPlatformFee(ticketPriceInPaisa: number): number {
  if (ticketPriceInPaisa === 0) return 0;
  if (ticketPriceInPaisa < 10000) {
    return 600; // flat 6 rupee (600 paisa)
  }
  return Math.round(ticketPriceInPaisa * 0.06);
}

/**
 * Total amount charged to the user at checkout (ticket + platform fee), in paisa.
 */
export function calculateUserTotal(ticketPriceInPaisa: number): number {
  return ticketPriceInPaisa + calculateUserPlatformFee(ticketPriceInPaisa);
}

/**
 * Amount the host receives per ticket sold, after commission deduction (in paisa).
 */
export function calculateHostPayoutPerTicket(
  ticketPriceInPaisa: number,
  commissionRate: number = DEFAULT_HOST_COMMISSION_RATE
): number {
  return Math.round(ticketPriceInPaisa * (1 - commissionRate / 100));
}

/**
 * Deposit amount the host must pay when creating a paid event (in paisa).
 * = 10% of one ticket price, rounded down.
 */
export function calculateDepositAmount(ticketPriceInPaisa: number): number {
  if (ticketPriceInPaisa === 0) return 0;
  return Math.round(ticketPriceInPaisa * 0.1);
}

/**
 * Returns a human-readable fee breakdown object for a given ticket price.
 * Useful for API responses shown to guests before purchase.
 */
export function getFeeBreakdown(ticketPriceInPaisa: number, commissionRate: number = DEFAULT_HOST_COMMISSION_RATE) {
  const platformFee = calculateUserPlatformFee(ticketPriceInPaisa);
  const userTotal = ticketPriceInPaisa + platformFee;
  const hostPayout = calculateHostPayoutPerTicket(ticketPriceInPaisa, commissionRate);
  const feeRatePercent = Math.round(getUserFeeRate(ticketPriceInPaisa) * 1000) / 10; // e.g. 5.5

  return {
    ticket_price: ticketPriceInPaisa,
    platform_fee: platformFee,
    platform_fee_rate_percent: feeRatePercent,
    user_total: userTotal,
    host_commission: ticketPriceInPaisa - hostPayout,
    host_commission_rate_percent: commissionRate,
    host_payout_per_ticket: hostPayout,
  };
}
