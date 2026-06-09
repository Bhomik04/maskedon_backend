import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
	register,
	login,
	refresh,
	logout,
	forgotPassword,
	resendVerification,
	verifyEmail,
	resetPassword,
} from "../controllers/auth-controller";
import { asyncHandler } from "../utils/async-handler";
import { authenticate } from "../middleware/auth";

const router = Router();

function safeRateLimitKey(req: { ip?: string; body?: unknown }): string {
	const email =
		typeof (req.body as { email?: unknown } | undefined)?.email === "string" &&
		(req.body as { email: string }).email.trim().length > 0
			? (req.body as { email: string }).email.trim().toLowerCase()
			: "unknown";

	const ip = typeof req.ip === "string" && req.ip.length > 0 ? req.ip : "unknown-ip";
	return `${ip}:${email}`;
}

const loginWindowMinutes = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || "10", 10);
const loginMaxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "8", 10);
const registerWindowMinutes = parseInt(process.env.REGISTER_RATE_LIMIT_WINDOW_MINUTES || "30", 10);
const registerMaxAttempts = parseInt(process.env.REGISTER_RATE_LIMIT_MAX || "10", 10);
const refreshWindowMinutes = parseInt(process.env.REFRESH_RATE_LIMIT_WINDOW_MINUTES || "10", 10);
const refreshMaxAttempts = parseInt(process.env.REFRESH_RATE_LIMIT_MAX || "30", 10);
const forgotWindowMinutes = parseInt(process.env.FORGOT_RATE_LIMIT_WINDOW_MINUTES || "15", 10);
const forgotMaxAttempts = parseInt(process.env.FORGOT_RATE_LIMIT_MAX || "8", 10);
const resendWindowMinutes = parseInt(process.env.RESEND_RATE_LIMIT_WINDOW_MINUTES || "15", 10);
const resendMaxAttempts = parseInt(process.env.RESEND_RATE_LIMIT_MAX || "8", 10);

const registerLimiter = rateLimit({
	windowMs: registerWindowMinutes * 60 * 1000,
	max: registerMaxAttempts,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	keyGenerator(req) {
		return safeRateLimitKey(req);
	},
	message: {
		success: false,
		error: { code: "RATE_LIMIT", message: "Too many registration attempts, please try again later" },
	},
});

const loginLimiter = rateLimit({
	windowMs: loginWindowMinutes * 60 * 1000,
	max: loginMaxAttempts,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	keyGenerator(req) {
		return safeRateLimitKey(req);
	},
	message: {
		success: false,
		error: { code: "RATE_LIMIT", message: "Too many login attempts, please try again later" },
	},
});

const refreshLimiter = rateLimit({
	windowMs: refreshWindowMinutes * 60 * 1000,
	max: refreshMaxAttempts,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	message: {
		success: false,
		error: { code: "RATE_LIMIT", message: "Too many token refresh attempts, please try again later" },
	},
});

const forgotLimiter = rateLimit({
	windowMs: forgotWindowMinutes * 60 * 1000,
	max: forgotMaxAttempts,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	keyGenerator(req) {
		return safeRateLimitKey(req);
	},
	message: {
		success: false,
		error: { code: "RATE_LIMIT", message: "Too many password reset requests, please try again later" },
	},
});

const resendLimiter = rateLimit({
	windowMs: resendWindowMinutes * 60 * 1000,
	max: resendMaxAttempts,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	keyGenerator(req) {
		return safeRateLimitKey(req);
	},
	message: {
		success: false,
		error: { code: "RATE_LIMIT", message: "Too many verification email requests, please try again later" },
	},
});

router.post("/register", registerLimiter, asyncHandler(register));
router.post("/login", loginLimiter, asyncHandler(login));
router.post("/forgot-password", forgotLimiter, asyncHandler(forgotPassword));
router.post("/resend-verification", resendLimiter, asyncHandler(resendVerification));
router.get("/verify-email", asyncHandler(verifyEmail));
router.post("/reset-password", asyncHandler(resetPassword));
router.post("/refresh", refreshLimiter, asyncHandler(refresh));
router.post("/logout", authenticate, asyncHandler(logout));

export default router;
