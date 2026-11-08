// Preserve the current generic SDK contract while standalone contract packaging
// is qualified. This is a type-only dependency; runtime assembly is native.
export { createSDK, mergeApprovalsRoot, validateObjectSchema } from "toolcraft/sdk";
export type { CreateSDKOptions } from "toolcraft/sdk";
