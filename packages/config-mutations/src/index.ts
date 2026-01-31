// Main exports
export { configMutation } from "./mutations/config-mutation.js";
export { fileMutation } from "./mutations/file-mutation.js";
export { templateMutation } from "./mutations/template-mutation.js";
export { runMutations } from "./execution/run-mutations.js";

// Types
export type {
  Mutation,
  MutationContext,
  MutationResult,
  MutationObservers,
  MutationDetails,
  MutationOutcome,
  FileSystem,
  TemplateLoader,
  ConfigFormat,
  PathMapper
} from "./types.js";
