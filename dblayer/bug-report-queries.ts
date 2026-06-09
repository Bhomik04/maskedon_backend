import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

export interface CreateBugReportInput {
  reporterId: string | null;
  category: string;
  severity: string;
  affectedFeature?: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  screenshotUrls: string[];
}

export interface BugReport {
  id: string;
  reporter_id: string | null;
  category: string;
  severity: string;
  affected_feature: string | null;
  steps_to_reproduce: string;
  expected_behavior: string;
  actual_behavior: string;
  screenshot_urls: string[];
  status: string;
  created_at: string;
}

export async function createBugReport(input: CreateBugReportInput): Promise<BugReport> {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO bug_reports
       (id, reporter_id, category, severity, affected_feature, steps_to_reproduce, expected_behavior, actual_behavior, screenshot_urls)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
     RETURNING *`,
    [
      id,
      input.reporterId ?? null,
      input.category,
      input.severity,
      input.affectedFeature ?? null,
      input.stepsToReproduce,
      input.expectedBehavior,
      input.actualBehavior,
      JSON.stringify(input.screenshotUrls),
    ]
  );
  return result.rows[0];
}
