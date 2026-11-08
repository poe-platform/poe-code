import { type ToolCallSummary } from "./stream-helpers.js";
import type { Cost, SessionUpdate, SessionUpdateNotification } from "./types.js";
type SessionUpdateStreamItem = SessionUpdateNotification | SessionUpdate;
export type RunExitStatus = "success" | "failed";
export interface RunReportUsage {
  used: number;
  size: number;
  updates: number;
  cost?: Cost | null;
}
export interface RunReportError {
  message: string;
  toolCallId?: string;
}
export interface RunReport {
  runId: string;
  startTime: string;
  endTime: string;
  exitStatus: RunExitStatus;
  toolCalls: ToolCallSummary[];
  usage: RunReportUsage;
  errors: RunReportError[];
}
export interface GenerateRunReportOptions {
  runId?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  exitStatus?: RunExitStatus;
  errors?: string[];
  now?: () => Date;
}
export type RunReportFileSystem = {
  mkdir(
    path: string,
    options?: {
      recursive?: boolean;
    }
  ): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options?: {
      encoding?: BufferEncoding;
      flag?: string;
    }
  ): Promise<void>;
  rm(
    path: string,
    options?: {
      force?: boolean;
    }
  ): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
  realpath?(path: string): Promise<string>;
};
export interface SaveRunReportOptions {
  fs?: RunReportFileSystem;
  homeDir?: string;
  includeRawContent?: boolean;
  now?: () => Date;
}
export interface SavedRunReportPaths {
  reportsDir: string;
  jsonPath: string;
  summaryPath: string;
}
export declare function generateRunReportFromSessionUpdateStream(
  stream: AsyncIterable<SessionUpdateStreamItem> | Iterable<SessionUpdateStreamItem>,
  options?: GenerateRunReportOptions
): Promise<RunReport>;
export declare function formatRunReportSummary(report: RunReport): string;
export declare function saveRunReport(
  report: RunReport,
  options?: SaveRunReportOptions
): Promise<SavedRunReportPaths>;
export {};
