import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./poe-agent-rust.node");
