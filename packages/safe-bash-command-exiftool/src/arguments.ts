import { exiftoolRegistry } from "./registry.js";
import type { TagAssignment } from "./png.js";
import type { ResourceLimits } from "./resources.js";
export interface Invocation {
  readonly files: string[]; readonly tags: string[]; readonly assignments: TagAssignment[];
  json: boolean; csv: boolean; quoteScalars: boolean; duplicates: boolean; binary: boolean; missing: boolean;
  style: "short" | "compact" | "values"; overwrite: "backup" | "replace" | "in-place";
  destination: string | undefined;
  groupFamily: 4 | undefined;
}
export function parseArguments(args: readonly string[], limits: ResourceLimits): Invocation {
  if (args.length > 4096) throw new RangeError("ExifTool argument count exceeded");
  let extent = 0;
  for (const arg of args) { extent += arg.length * 2; if (extent > limits.maxDecodedBytes) throw new RangeError("ExifTool argument decoded budget exceeded"); }
  const result: Invocation = { files: [], tags: [], assignments: [], json: false, csv: false, quoteScalars: false, duplicates: false,
    binary: false, missing: false, style: "short", overwrite: "backup", destination: undefined, groupFamily: undefined };
  let literal = false;
  let valueConvSelector = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const option = arg.toLowerCase();
    const value = (): string => { if (++index >= args.length) throw new Error("Missing argument for " + arg); return args[index]!; };
    if (literal || !arg.startsWith("-") || arg === "-") { result.files.push(arg); continue; }
    if (arg === "--") { literal = true; continue; }
    if (option === "-config") { if (value() !== "") throw new Error("User configuration modules are not supported"); continue; }
    if (option === "-j" || option === "-json") { result.json = true; continue; }
    if (option === "-csv") { result.csv = true; continue; }
    if (arg === "-G4") { result.groupFamily = 4; continue; }
    if (option === "-api") { if (value().toLowerCase() !== "structformat=jsonq") throw new Error("API option not yet supported"); result.quoteScalars = true; continue; }
    if (option === "-a") { result.duplicates = true; continue; }
    if (option === "-b") { result.binary = true; continue; }
    if (option === "-f") { result.missing = true; continue; }
    if (arg === "-S") { result.style = "compact"; continue; }
    if (option === "-s" || option === "-s1") { result.style = "short"; continue; }
    if (option === "-s3") { result.style = "values"; continue; }
    if (option === "-n") continue; // admitted PNG text tags have no PrintConv
    if (option === "-overwrite_original") { result.overwrite = "replace"; continue; }
    if (option === "-overwrite_original_in_place") { result.overwrite = "in-place"; continue; }
    if (option === "-o") { result.destination = value(); continue; }
    if (["-if", "-p", "-stay_open", "-@", "-common_args"].includes(option) || option.startsWith("-execute")) throw new Error("ExifTool option not yet supported (no code evaluation or ambient polling): " + arg);
    const equals = arg.indexOf("=");
    let name = arg.slice(1, equals < 0 ? undefined : equals);
    const operation = name.endsWith("+") ? "add" : name.endsWith("-") ? "remove" : "set";
    if (operation !== "set") name = name.slice(0, -1);
    if (name.endsWith("#")) { if (equals < 0) valueConvSelector = true; name = name.slice(0, -1); }
    const known = exiftoolRegistry.tags.find(tag => tag.toLowerCase() === name.toLowerCase());
    if (equals >= 0) result.assignments.push({ name: known ?? name, operation, value: arg.slice(equals + 1) });
    else if (known || name === "MissingTag") result.tags.push(known ?? name);
    else throw new Error("ExifTool option/tag not yet supported: " + arg);
  }
  if (!result.files.length) throw new Error("No file specified");
  if (result.files.filter(file => file === "-").length > 1) throw new Error("Repeated stdin operands are not supported");
  if (result.files.includes("-") && result.assignments.length) throw new Error("Writing stdin metadata is not yet supported");
  if (result.files.length > 64) throw new RangeError("ExifTool file count exceeded");
  if (result.destination !== undefined && (result.files.length !== 1 || !result.assignments.length)) throw new Error("-o requires a single file with tag assignments in this profile");
  if (result.json && result.binary) throw new Error("JSON binary policy not yet supported");
  if (result.csv && (result.json || result.binary || result.assignments.length)) throw new Error("CSV combined output/import policy not yet supported");
  if (result.csv && valueConvSelector) throw new Error("CSV ValueConv-qualified headers not yet supported");
  if (result.groupFamily !== undefined && (!result.json || result.assignments.length)) throw new Error("Group-family qualification outside JSON not yet supported");
  return result;
}
