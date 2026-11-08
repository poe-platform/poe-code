import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const widths = native.designTokens("widths");
