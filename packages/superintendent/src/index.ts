// Document
export {
  parseSuperintendentDoc,
  resolveSuperintendentDoc,
  superintendentBaseDocumentSchema,
  superintendentBaseDocumentSchemaId,
  superintendentDocumentSchema,
  superintendentDocumentSchemaId
} from "./document/parse.js";
export { updateStatus, transitionState, incrementRound } from "./document/write.js";
export { parseTaskBoard, hasTaskBoard } from "./document/tasks.js";
export type {
  ResolvedSuperintendentDoc,
  SuperintendentDocumentFileSystem,
  SuperintendentDoc,
  SuperintendentFrontmatter,
  StatusBlock,
  TaskBoard,
  TaskItem
} from "./document/parse.js";

// Runtime
export { runLoop } from "./runtime/loop.js";
export { runBuilder } from "./runtime/run-builder.js";
export { runInspector, runAllInspectors } from "./runtime/run-inspector.js";
export { resolveTemplate } from "./runtime/templates.js";
export type {
  LoopCallbacks,
  RunLoopOptions,
  AgentRunInput,
  AgentRunResult
} from "./runtime/loop.js";
export type { BuilderResult, InspectorResult, TemplateContext } from "./runtime/types.js";

// State
export { createLoopState, applyTransition, isComplete } from "./state/machine.js";

// Commands (for composition)
export { superintendentGroup } from "./commands/index.js";

// Config
export { superintendentConfigScope } from "./config-scope.js";
