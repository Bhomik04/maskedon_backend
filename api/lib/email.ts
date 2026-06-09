import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || "maskedon <team@maskedon.com>";
const DEV_MODE = process.env.EMAIL_DEV_MODE === "true";

/**
 * Sends a verification email with a one-click link.
 * In dev mode, logs the link to console and skips the API call.
 */
export async function sendVerificationEmail(
  to: string,
  displayName: string,
  verifyUrl: string
): Promise<void> {
  if (DEV_MODE) {
    console.log(`[email:dev] Verification email for ${to} → ${verifyUrl}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: "Verify your maskedOn email",
    html: buildVerificationHtml(displayName, verifyUrl),
    text: buildVerificationText(displayName, verifyUrl),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

/**
 * Sends a password reset email with a one-click link.
 * In dev mode, logs the link to console and skips the API call.
 */
export async function sendPasswordResetEmail(
  to: string,
  displayName: string,
  resetUrl: string
): Promise<void> {
  if (DEV_MODE) {
    console.log(`[email:dev] Password reset email for ${to} → ${resetUrl}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: "Reset your maskedOn password",
    html: buildResetHtml(displayName, resetUrl),
    text: buildResetText(displayName, resetUrl),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

// ── Email Templates ──────────────────────────────────────────────────────────

function buildVerificationHtml(displayName: string, verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d14;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#13131f;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">maskedOn</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;letter-spacing:0.1em;text-transform:uppercase;">Verify your email</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 12px;color:#d1d5db;font-size:15px;">Hi <strong style="color:#ffffff;">${escapeHtml(displayName)}</strong>,</p>
          <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6;">
            Welcome to maskedOn. Click the button below to verify your email address and activate your account.
            This link expires in <strong style="color:#ffffff;">24 hours</strong>.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">
              Verify email address
            </a>
          </div>
          <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">Or paste this link into your browser:</p>
          <p style="margin:0;font-size:11px;color:#4b5563;word-break:break-all;">${verifyUrl}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;color:#6b7280;font-size:12px;">
            If you didn't create a maskedOn account, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildVerificationText(displayName: string, verifyUrl: string): string {
  return `Hi ${displayName},

Welcome to maskedOn! Verify your email address by visiting the link below.
This link expires in 24 hours.

${verifyUrl}

If you didn't create a maskedOn account, ignore this email.

— The maskedOn team`;
}

function buildResetHtml(displayName: string, resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d14;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#13131f;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">maskedOn</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280;letter-spacing:0.1em;text-transform:uppercase;">Reset your password</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 12px;color:#d1d5db;font-size:15px;">Hi <strong style="color:#ffffff;">${escapeHtml(displayName)}</strong>,</p>
          <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6;">
            We received a request to reset your maskedOn password. Click the button below to choose a new password.
            This link expires in <strong style="color:#ffffff;">1 hour</strong>. If you didn't request a reset, you can safely ignore this email — your password will not change.
          </p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">
              Reset password
            </a>
          </div>
          <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">Or paste this link into your browser:</p>
          <p style="margin:0;font-size:11px;color:#4b5563;word-break:break-all;">${resetUrl}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;color:#6b7280;font-size:12px;">
            For security, this link can only be used once and expires in 1 hour.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildResetText(displayName: string, resetUrl: string): string {
  return `Hi ${displayName},

We received a request to reset your maskedOn password.
Visit the link below to choose a new password (expires in 1 hour):

${resetUrl}

If you didn't request this, ignore this email — your password will not change.

— The maskedOn team`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
