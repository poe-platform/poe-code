import type { FileAwareness } from "./plugin-types.js";
export interface FileAwarenessTracker {
  recordRead(filePath: string): void;
  recordWrite(filePath: string): void;
  snapshot(): FileAwareness;
}
export declare function createFileAwarenessTracker(cwd: string): FileAwarenessTracker;
export declare function recordToolFileAwareness(options: {
  tracker: FileAwarenessTracker;
  tool: string;
  args: unknown;
}): void;
