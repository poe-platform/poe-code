import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./mcp-protocol-rust.node");

export const { parseJson, parseJsonUtf8, canonicalizeJson, parseMessage, parseMessageUtf8 } =
  native;
