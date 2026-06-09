/**
 * PAN & Bank Account Validator
 * Pure logic — no HTTP, no DB.
 *
 * Performs format-level validation and flags obvious issues
 * to help admins triage verification submissions faster.
 */

export interface PanValidationResult {
  valid: boolean;
  panType: "Individual" | "Company" | "HUF" | "Firm" | "AOP/BOI" | "Trust" | "Unknown";
  flags: string[];
}

export interface AadhaarValidationResult {
  valid: boolean;
  flags: string[];
}

export interface BankValidationResult {
  valid: boolean;
  flags: string[];
}

export interface KycValidationResult {
  pan: PanValidationResult;
  aadhaar: AadhaarValidationResult;
  bank: BankValidationResult;
  overallValid: boolean;
  allFlags: string[];
}

// PAN format: AAAAA9999A — 5 uppercase letters, 4 digits, 1 uppercase letter
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// IFSC format: 4 uppercase letters, 0, 6 alphanumeric
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Aadhaar format: exactly 12 digits
const AADHAAR_REGEX = /^[0-9]{12}$/;

// Bank account number: 9–18 digits
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;

const PAN_TYPE_MAP: Record<string, PanValidationResult["panType"]> = {
  P: "Individual",
  C: "Company",
  H: "HUF",
  F: "Firm",
  A: "AOP/BOI",
  T: "Trust",
  B: "AOP/BOI",
  L: "AOP/BOI",
  J: "AOP/BOI",
  G: "AOP/BOI",
};

/**
 * Validate a PAN card number and infer holder type.
 */
export function validatePan(pan: string, nameOnPan: string): PanValidationResult {
  const flags: string[] = [];
  const upper = pan.toUpperCase().trim();

  if (!PAN_REGEX.test(upper)) {
    return {
      valid: false,
      panType: "Unknown",
      flags: ["PAN format invalid — expected 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)"],
    };
  }

  // 4th character encodes the holder type
  const typeChar = upper[3];
  const panType = PAN_TYPE_MAP[typeChar] ?? "Unknown";

  if (panType === "Unknown") {
    flags.push(`Unrecognised PAN type character '${typeChar}'`);
  }

  // 5th character should match first letter of surname/entity name for individuals
  if (panType === "Individual") {
    const expectedInitial = upper[4];
    const normalizedName = nameOnPan.trim().toUpperCase();
    // Get first word (surname for Indian PAN — last part of name on card)
    const parts = normalizedName.split(/\s+/);
    const firstChar = parts[0]?.[0] ?? "";
    if (firstChar && firstChar !== expectedInitial) {
      flags.push(
        `PAN 5th character '${expectedInitial}' doesn't match first letter of name '${firstChar}' — possible name mismatch`
      );
    }
  }

  // Disallow company/trust PANs for individual host registration
  if (["Company", "HUF", "Firm", "Trust"].includes(panType)) {
    flags.push(`PAN type '${panType}' — ensure this is the correct business type for an event host`);
  }

  return { valid: true, panType, flags };
}

/**
 * Validate bank account number and IFSC code.
 */
export function validateBankDetails(
  accountNumber: string,
  ifsc: string,
  accountHolderName: string
): BankValidationResult {
  const flags: string[] = [];
  let valid = true;

  if (!ACCOUNT_NUMBER_REGEX.test(accountNumber.trim())) {
    flags.push("Account number must be 9–18 digits with no spaces or dashes");
    valid = false;
  }

  const upperIfsc = ifsc.toUpperCase().trim();
  if (!IFSC_REGEX.test(upperIfsc)) {
    flags.push("IFSC code format invalid — expected 4 letters, '0', 6 alphanumeric characters (e.g. SBIN0001234)");
    valid = false;
  }

  if (accountHolderName.trim().length < 2) {
    flags.push("Account holder name is too short");
    valid = false;
  }

  return { valid, flags };
}

/**
 * Validate Aadhaar number and name format.
 */
export function validateAadhaar(aadhaarNumber: string, nameOnAadhaar: string): AadhaarValidationResult {
  const flags: string[] = [];
  let valid = true;

  const normalized = aadhaarNumber.trim();
  if (!AADHAAR_REGEX.test(normalized)) {
    flags.push("Aadhaar number must be exactly 12 digits");
    valid = false;
  }

  if (nameOnAadhaar.trim().length < 2) {
    flags.push("Name on Aadhaar must be at least 2 characters");
    valid = false;
  }

  return { valid, flags };
}

/**
 * Full KYC validation combining PAN and bank checks.
 */
export function validateKyc(input: {
  panNumber: string;
  panName: string;
  aadhaarNumber: string;
  aadhaarName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccountName: string;
}): KycValidationResult {
  const pan = validatePan(input.panNumber, input.panName);
  const aadhaar = validateAadhaar(input.aadhaarNumber, input.aadhaarName);
  const bank = validateBankDetails(
    input.bankAccountNumber,
    input.bankIfsc,
    input.bankAccountName
  );

  return {
    pan,
    aadhaar,
    bank,
    overallValid: pan.valid && aadhaar.valid && bank.valid,
    allFlags: [...pan.flags, ...aadhaar.flags, ...bank.flags],
  };
}
