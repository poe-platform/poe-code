import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./poe-acp-client-rust.node");
