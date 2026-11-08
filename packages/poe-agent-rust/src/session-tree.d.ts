import type { ChatMessage } from "./types.js";
import type { SessionEntry } from "./entry-types.js";
export declare function buildMessages(
  entries: SessionEntry[],
  headId: string | null
): ChatMessage[];
export declare function findHead(entries: SessionEntry[]): string | null;
export declare function collectBranch(entries: SessionEntry[], headId: string): SessionEntry[];
