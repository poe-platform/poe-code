export interface LogEntry {
  path: string;
  filename: string;
  agent?: string;
  timestamp?: Date;
}
export declare function listSpawnLogs(options?: {
  agent?: string;
  limit?: number;
}): Promise<LogEntry[]>;
export declare function findLatestLog(agent?: string): Promise<string | undefined>;
export declare function pickRandomLog(agent?: string): Promise<string | undefined>;
