import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
export const spacing = native.designTokens("spacing");
