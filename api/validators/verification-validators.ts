import { z } from "zod/v4";

// PAN: 5 uppercase letters + 4 digits + 1 uppercase letter
const PAN_REGEX = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/;

// Aadhaar: 12 digits
const AADHAAR_REGEX = /^[0-9]{12}$/;

// IFSC: 4 uppercase letters + 0 + 6 alphanumeric
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;

// Bank account: 9–18 digits
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;

export const submitVerificationSchema = z.object({
  pan_number: z
    .string()
    .trim()
    .regex(PAN_REGEX, "Invalid PAN number format (expected e.g. ABCDE1234F)"),
  pan_name: z
    .string()
    .trim()
    .min(2, "Name on PAN must be at least 2 characters")
    .max(200, "Name too long"),
  aadhaar_number: z
    .string()
    .trim()
    .regex(AADHAAR_REGEX, "Invalid Aadhaar format (expected exactly 12 digits)"),
  aadhaar_name: z
    .string()
    .trim()
    .min(2, "Name on Aadhaar must be at least 2 characters")
    .max(200, "Name too long"),
  bank_account_number: z
    .string()
    .trim()
    .regex(ACCOUNT_NUMBER_REGEX, "Account number must be 9–18 digits"),
  bank_ifsc: z
    .string()
    .trim()
    .regex(IFSC_REGEX, "Invalid IFSC code (expected e.g. SBIN0001234)"),
  bank_account_name: z
    .string()
    .trim()
    .min(2, "Account holder name must be at least 2 characters")
    .max(200, "Name too long"),
  bank_name: z
    .string()
    .trim()
    .min(2, "Bank name is required")
    .max(100, "Bank name too long"),
});

export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>;
