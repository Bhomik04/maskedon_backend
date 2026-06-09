import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import * as notifCtrl from "../controllers/notification-controller";

const router = Router();

router.use(authenticate);
router.param("notificationId", validateUUIDParam);

router.get("/", asyncHandler(notifCtrl.list));
router.get("/unread-count", asyncHandler(notifCtrl.unreadCount));
router.patch("/read-all", asyncHandler(notifCtrl.readAll));
router.patch("/:notificationId/read", asyncHandler(notifCtrl.read));
router.delete("/all", asyncHandler(notifCtrl.removeAll));
router.delete("/:notificationId", asyncHandler(notifCtrl.remove));

export default router;
