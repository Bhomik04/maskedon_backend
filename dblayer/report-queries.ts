import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

export type ReportTargetType = "user" | "event" | "photo";
export type ReportReason = "spam" | "harassment" | "fake_event" | "inappropriate_content" | "underage" | "other";
export type ReportStatus = "open" | "reviewed" | "resolved" | "dismissed";

export interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  created_at: Date;
}

export async function createReport(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  description?: string
): Promise<ReportRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, reporterId, targetType, targetId, reason, description || null]
  );
  const result = await query<ReportRow>("SELECT * FROM reports WHERE id = ?", [id]);
  return result.rows[0]!;
}

export async function findExistingReport(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string
): Promise<ReportRow | null> {
  const result = await query<ReportRow>(
    "SELECT * FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?",
    [reporterId, targetType, targetId]
  );
  return result.rows[0] || null;
}
