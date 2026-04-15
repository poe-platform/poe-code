// Document
export { parseSuperintendentDoc } from "./document/parse.js";
export { updateStatus, transitionState, incrementRound } from "./document/write.js";
export { parseTaskBoard, hasTaskBoard } from "./document/tasks.js";
export type {
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
  BuilderResult,
  InspectorResult,
  TemplateContext
} from "./runtime/types.js";

// State
export { createLoopState, applyTransition, isComplete } from "./state/machine.js";

// Testing
export * from "./testing/index.js";

// Commands (for composition)
export { superintendentGroup } from "./commands/index.js";

// Config
export { superintendentConfigScope } from "./config-scope.js";
