import { adaptClaude } from "./claude.js";
import { adaptCodex } from "./codex.js";
import { adaptKimi } from "./kimi.js";
import { adaptNative } from "./native.js";
import { adaptOpenCode } from "./opencode.js";
import { adaptPi } from "./pi.js";
import { adaptCursor } from "./cursor.js";
import type { AcpEvent, SessionUpdate } from "../acp/types.js";

export { adaptCodex } from "./codex.js";
export { adaptClaude } from "./claude.js";
export { adaptKimi } from "./kimi.js";
export { adaptNative } from "./native.js";
export { adaptOpenCode } from "./opencode.js";
export { adaptPi } from "./pi.js";
export { adaptCursor } from "./cursor.js";

export type AdapterType = "codex" | "claude" | "cursor" | "kimi" | "native" | "opencode" | "pi";

export type AdapterOutput = AcpEvent | SessionUpdate;
export type Adapter = (lines: AsyncIterable<string>) => AsyncGenerator<AdapterOutput>;

const adapters = {
  codex: adaptCodex,
  claude: adaptClaude,
  cursor: adaptCursor,
  kimi: adaptKimi,
  native: adaptNative,
  opencode: adaptOpenCode,
  pi: adaptPi
} satisfies Record<AdapterType, Adapter>;

export function getAdapter(type: AdapterType): Adapter {
  const adapter = (adapters as Record<string, Adapter | undefined>)[type];
  if (!adapter) {
    throw new Error(`Unknown adapter "${String(type)}".`);
  }
  return adapter;
}
