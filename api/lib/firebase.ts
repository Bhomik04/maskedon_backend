/**
 * Firebase Admin SDK initializer for FCM push notifications.
 *
 * Requires the environment variable FIREBASE_SERVICE_ACCOUNT_JSON to be set to the
 * contents of the Firebase service account JSON (as a single-line string).
 *
 * If the variable is not set, all push dispatch calls are silently skipped —
 * the app continues to work; users just won't receive push notifications until
 * the variable is configured on the server.
 */
import admin from "firebase-admin";
import { logger } from "./logger";

let messaging: admin.messaging.Messaging | null = null;

function getMessaging(): admin.messaging.Messaging | null {
  if (messaging) return messaging;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const serviceAccount = JSON.parse(raw) as admin.ServiceAccount;

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    messaging = admin.messaging();
    return messaging;
  } catch (err) {
    logger.error("Failed to initialise Firebase Admin SDK", err);
    return null;
  }
}

/**
 * Send an FCM push notification to a single device token.
 * Silently no-ops when Firebase is not configured.
 */
export async function sendPushToToken(
  token: string,
  title: string,
  body: string | undefined,
  data?: Record<string, string>
): Promise<void> {
  const fcm = getMessaging();
  if (!fcm) return;

  try {
    await fcm.send({
      token,
      notification: { title, body },
      data,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
  } catch (err: any) {
    // Log but never throw — a stale / invalid token should not crash the caller
    logger.warn("FCM send failed for token", { token: token.slice(0, 20), error: err?.message });
  }
}
