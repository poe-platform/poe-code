import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

export interface FileOpenMode {
  readonly action: "r" | "w" | "a" | "x";
  readonly binary: boolean;
  readonly updating: boolean;
}

/** Parse an already converted mode string; no filesystem operations occur here. */
export function parseFileMode(mode = "r", meter?: ExecutionMeter): FileOpenMode {
  meter?.checkpoint();
  const seen = new Set<string>();
  let action: FileOpenMode["action"] | undefined;
  let actions = 0, invalid = false;
  for (const character of mode) {
    meter?.checkpoint();
    // Continue past invalid flags so embedded NUL retains argument-validation
    // precedence. The set remains bounded by the seven recognized characters.
    if (character === "\0") throw new PythonRuntimeError("ValueError", "embedded null character");
    if (!"rwaxbt+".includes(character) || seen.has(character)) {
      invalid = true;
      continue;
    }
    seen.add(character);
    if (character === "r" || character === "w" || character === "a" || character === "x") {
      action = character;
      actions++;
    }
  }
  if (invalid) throw new PythonRuntimeError("ValueError", `invalid mode: '${mode}'`);
  if (seen.has("b") && seen.has("t")) throw new PythonRuntimeError("ValueError", "can't have text and binary mode at once");
  if (actions > 1) throw new PythonRuntimeError("ValueError", "must have exactly one of create/read/write/append mode");
  if (action === undefined) throw new PythonRuntimeError("ValueError", "Must have exactly one of create/read/write/append mode and at most one plus");
  return Object.freeze({ action, binary: seen.has("b"), updating: seen.has("+") });
}
