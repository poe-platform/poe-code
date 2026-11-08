import { createRequire } from "node:module";
export const native = createRequire(import.meta.url)("./providers-rust.node");
