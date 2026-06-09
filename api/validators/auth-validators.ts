import { z } from "zod/v4";

export const registerSchema = z.object({
  email: z.string().email("Valid email is required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be at most 50 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be at most 100 characters"),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format")
    .refine((dob) => {
      const birth = new Date(dob);
      if (isNaN(birth.getTime())) return false;
      const today = new Date();
      const age = today.getFullYear() - birth.getFullYear()
        - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
      return age >= 18;
    }, "You must be at least 18 years old to use this platform")
    .refine((dob) => {
      const birth = new Date(dob);
      if (isNaN(birth.getTime())) return false;
      const today = new Date();
      const age = today.getFullYear() - birth.getFullYear()
        - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
      return age <= 120;
    }, "Please enter a valid date of birth"),
  accepted_terms: z
    .boolean()
    .refine((v) => v === true, "You must accept Terms & Conditions"),
  accepted_privacy: z
    .boolean()
    .refine((v) => v === true, "You must accept Privacy Policy"),
});

export const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required").max(128, "Password must be at most 128 characters"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Token is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain at least one uppercase letter, one lowercase letter, and one number"
      ),
    confirm_password: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
