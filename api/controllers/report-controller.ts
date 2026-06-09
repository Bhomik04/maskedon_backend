import { Request, Response } from "express";
import { createReport, findExistingReport } from "../../dblayer/report-queries";
import { reportSchema } from "../validators/report-validators";

// POST /api/v1/reports — submit a report
export async function submitReport(req: Request, res: Response) {
  const me = req.user!.userId;

  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" },
    });
    return;
  }

  const { target_type, target_id, reason, description } = parsed.data;

  // Prevent self-reporting
  if (target_type === "user" && target_id === me) {
    res.status(400).json({
      success: false,
      error: { code: "SELF_REPORT", message: "You cannot report yourself" },
    });
    return;
  }

  // Prevent duplicate reports for the same target
  const existing = await findExistingReport(me, target_type, target_id);
  if (existing) {
    res.status(409).json({
      success: false,
      error: { code: "ALREADY_REPORTED", message: "You have already reported this" },
    });
    return;
  }

  const report = await createReport(me, target_type, target_id, reason, description);
  res.status(201).json({ success: true, data: { report } });
}
