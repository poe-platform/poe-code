import { createCommandArguments, type CommandArguments } from "safe-bash-contracts/command";
import { parseArguments } from "./arguments.js";
import type { TagAssignment } from "./png.js";
import { exiftoolRegistry } from "./registry.js";
import { Resources, type EngineOptions } from "./resources.js";

/** Typed options for the currently admitted CLI profile, not the full native catalog. */
export interface ExiftoolInvocationOptions {
  readonly files: readonly string[];
  readonly tags?: readonly string[];
  readonly assignments?: readonly TagAssignment[];
  readonly format?: "text" | "json" | "csv" | "binary";
  readonly style?: "short" | "compact" | "values";
  readonly duplicates?: boolean;
  readonly missing?: boolean;
  readonly numeric?: boolean;
  readonly quoteScalars?: boolean;
  readonly groupFamily?: 4;
  readonly overwrite?: "backup" | "replace" | "in-place";
  readonly destination?: string;
}

/** Build bounded, branded argv for direct CommandDefinition SDK invocation.
 * Operands are always literal; option values never acquire flag authority.
 * Argument construction is a separate bounded operation from command execution.
 */
export function createExiftoolArguments(options: ExiftoolInvocationOptions, engine: EngineOptions): CommandArguments {
  const resources = new Resources(engine);
  const supported = ["files", "tags", "assignments", "format", "style", "duplicates", "missing", "numeric", "quoteScalars", "groupFamily", "overwrite", "destination"];
  resources.admit("retained", 256);
  for (const key in options) {
    if (!Object.hasOwn(options, key)) continue;
    resources.admit("work", key.length * 2 + supported.length);
    resources.admit("retained", key.length * 2 + 32);
    if (!supported.includes(key)) throw new TypeError("Unsupported ExifTool SDK option: " + key);
  }
  const count = options.files.length + (options.tags?.length ?? 0) + (options.assignments?.length ?? 0);
  if (!Number.isSafeInteger(count) || count > 4096) throw new RangeError("ExifTool argument count exceeded");
  resources.admit("retained", 256);
  const args: string[] = [];
  const append = (...parts: readonly string[]): void => {
    if (args.length >= 4096) throw new RangeError("ExifTool argument count exceeded");
    let length = 0;
    for (const part of parts) {
      if (typeof part !== "string") throw new TypeError("ExifTool option values must be strings");
      length += part.length;
    }
    resources.admit("decoded", length * 2);
    resources.admit("retained", length * 8 + 128);
    resources.admit("work", length * 4 + 32);
    args.push(parts.join(""));
  };
  const tagName = (name: string, assignment: boolean): void => {
    if (typeof name !== "string") throw new TypeError("ExifTool tag names must be strings");
    resources.admit("work", name.length * 4 + 32);
    resources.admit("retained", name.length * 4 + 64);
    const selector = !assignment && name.endsWith("#") ? name.slice(0, -1) : name;
    if (!exiftoolRegistry.tags.some(tag => tag.toLowerCase() === selector.toLowerCase()) && selector !== "MissingTag" && !(assignment && selector === "all")) {
      throw new Error("ExifTool option/tag not yet supported: " + name);
    }
  };
  if (options.format !== undefined && options.format !== "text") {
    const flag = { json: "-j", csv: "-csv", binary: "-b" }[options.format];
    if (!flag) throw new TypeError("Unsupported ExifTool output format");
    append(flag);
  }
  if (options.style !== undefined) {
    const flag = { short: "-s", compact: "-S", values: "-s3" }[options.style];
    if (!flag) throw new TypeError("Unsupported ExifTool output style");
    append(flag);
  }
  if (options.duplicates) append("-a");
  if (options.missing) append("-f");
  if (options.numeric) append("-n");
  if (options.quoteScalars) { append("-api"); append("StructFormat=JSONQ"); }
  if (options.groupFamily !== undefined) {
    if (options.groupFamily !== 4) throw new TypeError("Unsupported ExifTool group family");
    append("-G4");
  }
  if (options.overwrite !== undefined && options.overwrite !== "backup") {
    const flag = { replace: "-overwrite_original", "in-place": "-overwrite_original_in_place" }[options.overwrite];
    if (!flag) throw new TypeError("Unsupported ExifTool overwrite policy");
    append(flag);
  }
  if (options.destination !== undefined) { append("-o"); append(options.destination); }
  for (const tag of options.tags ?? []) { tagName(tag, false); append("-", tag); }
  for (const assignment of options.assignments ?? []) {
    tagName(assignment.name, true);
    const suffix = { set: "=", remove: "-=", add: "+=" }[assignment.operation];
    if (!suffix) throw new TypeError("Unsupported ExifTool assignment operation");
    append("-", assignment.name, suffix, assignment.value);
  }
  append("--");
  for (const file of options.files) append(file);
  // Keep unsupported combination and stdin policy identical to CLI admission.
  resources.admit("retained", args.length * 128);
  resources.admit("work", resources.usage.decoded * 4 + args.length * 64);
  parseArguments(args, resources.limits);
  return createCommandArguments(args, {
    assertOpen() { engine.signal.throwIfAborted(); },
    reserve(bytes, slots) {
      resources.admit("retained", bytes + slots * 16);
      // Admission counts cumulative allocations, rather than live heap usage.
      return { commit() {}, release() {} };
    },
  });
}
