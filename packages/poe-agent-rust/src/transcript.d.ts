import type { AcpEvent } from "./types.js";
import type { SessionUpdate } from "./acp-types.js";
export declare function mapAcpEventToSessionUpdates(event: AcpEvent): SessionUpdate[];
export interface TranscriptWriter {
  write(event: AcpEvent): Promise<void>;
  close(): Promise<void>;
  readonly filePath: string;
}
export interface TranscriptFsApi {
  mkdir(dir: string, options: { recursive: true }): Promise<void>;
  appendFile(path: string, contents: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}
export interface CreateTranscriptWriterOptions {
  logPath?: string;
  logDir?: string;
  logFileName?: string;
  fs: TranscriptFsApi;
  pathJoin?: (...parts: string[]) => string;
}
export declare function createTranscriptWriter(options: CreateTranscriptWriterOptions): TranscriptWriter;
