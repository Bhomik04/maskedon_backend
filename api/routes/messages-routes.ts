import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import * as messagesCtrl from "../controllers/messages-controller";

const router = Router();

router.use(authenticate);
router.param("conversationId", validateUUIDParam);

router.get("/conversations", asyncHandler(messagesCtrl.listConversations));
router.post("/conversations", asyncHandler(messagesCtrl.startConversation));
router.get("/conversations/:conversationId/messages", asyncHandler(messagesCtrl.getMessages));
router.post("/conversations/:conversationId/messages", asyncHandler(messagesCtrl.sendMessage));
router.patch("/conversations/:conversationId/read", asyncHandler(messagesCtrl.markRead));
router.get("/unread-count", asyncHandler(messagesCtrl.unreadCount));

export default router;