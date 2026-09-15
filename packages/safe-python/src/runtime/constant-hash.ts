// Compatibility exports: immutable keys use the shared runtime hash engine.
export { runtimeHash as constantHash } from "./runtime-hash.js";
export type { ConstantHashContext } from "./runtime-hash.js";
