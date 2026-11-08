import type { SessionUpdate } from "./acp-protocol-types.js";
export interface MalformedSpawnLogRecord {
  filePath: string;
  lineNumber: number;
  message: string;
}
export interface ReadSpawnLogOptions {
  strict?: boolean;
  onMalformedRecord?: (record: MalformedSpawnLogRecord) => void;
}
export declare function readSpawnLog(
  filePath: string,
  options?: ReadSpawnLogOptions
): AsyncIterable<SessionUpdate>;
