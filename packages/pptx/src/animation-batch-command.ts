import type { Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { validateAnimationOptions, type AnimationTarget, type MutateAnimationsOptions, type AnimationBatchOperation } from "./animation-editing.js";
import { decodeSelectionToken, SelectionError, type SelectionIndex, type SelectionQuery } from "./selectors.js";

function invalid(message: string): never { throw new OfficeError("invalid-value", message, "usage"); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid("Invalid animation batch fields.");
  return value as Record<string, unknown>;
}
export function animationTargetArgument(value: unknown): AnimationTarget {
  if (typeof value === "string") return value;
  const object = record(value, ["slide", "shape", "fingerprint", "scope", "owner", "objectId", "coordinateSystem"]);
  if (Object.hasOwn(object, "slide")) {
    record(object, ["slide", "shape"]);
    if (!Number.isSafeInteger(object.slide) || (object.slide as number) < 1 || typeof object.shape !== "string" || !object.shape) invalid("Animation target requires a one-based slide and shape name.");
    return { slide: { coordinateSystem: "one-based", value: object.slide as number }, shape: object.shape };
  }
  return decodeSelectionToken(JSON.stringify(object));
}
export interface AnimationBatchItem {
  readonly operation: "animations.add" | "animations.set" | "animations.remove";
  readonly arguments: Omit<MutateAnimationsOptions, "selection" | "allowEmpty">;
  readonly options: { readonly slide?: number; readonly shape?: string; readonly select?: Location; readonly scope?: "slides"; readonly all?: boolean; readonly allowEmpty?: boolean };
}
export function parseAnimationBatch(value: unknown): readonly AnimationBatchItem[] {
  const envelope = record(value, ["version", "operations"]);
  if (envelope.version !== 1 || !Array.isArray(envelope.operations) || envelope.operations.length > 1000) invalid("Batch requires version 1 and at most 1000 operations.");
  return envelope.operations.map((entry: unknown) => {
    const item = record(entry, ["operation", "arguments", "options"]);
    if (!["animations.add", "animations.set", "animations.remove"].includes(item.operation as string)) invalid("Batch supports animation add, set and remove only.");
    const operation = item.operation as AnimationBatchItem["operation"];
    const args = record(item.arguments, ["kind", "trigger", "target", "duration", "delay"]);
    const editing = { ...args, ...(Object.hasOwn(args, "target") ? { target: animationTargetArgument(args.target) } : {}) } as AnimationBatchItem["arguments"];
    validateAnimationOptions(operation.slice(11) as "add" | "set" | "remove", editing);
    const options = item.options === undefined ? {} : record(item.options, ["slide", "shape", "select", "scope", "all", "allowEmpty"]);
    if (options.slide !== undefined && (!Number.isSafeInteger(options.slide) || (options.slide as number) < 1)) invalid("Batch slide must be one-based.");
    if (options.shape !== undefined && (typeof options.shape !== "string" || !options.shape || options.slide === undefined)) invalid("Batch shape requires an owning slide.");
    if (options.scope !== undefined && options.scope !== "slides") invalid("Animations require slides scope.");
    for (const key of ["all", "allowEmpty"]) if (options[key] !== undefined && typeof options[key] !== "boolean") invalid("Batch controls require booleans.");
    if (options.select !== undefined) {
      if (["scope", "slide", "shape"].some(key => Object.hasOwn(options, key))) invalid("Opaque and simple selectors cannot be combined.");
      decodeSelectionToken(JSON.stringify(options.select));
    }
    if (operation !== "animations.add" && options.select === undefined && options.slide === undefined && options.all !== true) invalid("Animation mutation requires a selector or all.");
    return { operation, arguments: editing, options: options as AnimationBatchItem["options"] };
  });
}
export function resolveAnimationBatch(items: readonly AnimationBatchItem[], index: SelectionIndex): readonly AnimationBatchOperation[] {
  return items.map(item => {
    const options = item.options;
    let selection: SelectionQuery | undefined = options.select ? { token: JSON.stringify(options.select) } : options.slide === undefined ? undefined : { kind: "slide", scope: "slides", position: { coordinateSystem: "one-based", value: options.slide } };
    if (options.shape !== undefined) {
      try {
        const slide = index.select(selection!)[0]!;
        selection = { kind: "object", scope: "slides", owner: slide.part, name: options.shape };
      } catch (error) {
        if (!(options.allowEmpty && error instanceof SelectionError && error.code === "missing-selection")) throw error;
      }
    }
    if (options.all) selection = { ...(selection ?? { kind: "slide", scope: "slides" }), all: true };
    return { action: item.operation.slice(11) as "add" | "set" | "remove", options: { ...item.arguments, ...(selection ? { selection } : {}), ...(options.allowEmpty === undefined ? {} : { allowEmpty: options.allowEmpty }) } };
  });
}
