import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./agent-spawn-rust.node");
