import { resolvePath } from "../../contracts/index.js";
import { objectPath } from "./io.js";
import { GIT_LIMITS, GitFailure } from "./limits.js";

export interface Arguments {
  command: string; cwd: string; literal: boolean; paths: string[]; operands: string[];
  flags: Set<string>; untracked: "no" | "normal" | "all"; context: number; count: number | undefined;
  format: "oneline" | "%H" | "%H %s" | undefined;
}

function usage(message: string): never { throw new GitFailure(message, 129); }

export function argumentsFor(args: readonly string[], cwd: string): Arguments {
  if (!Array.isArray(args) || args.length > 128) usage("Git argv count exceeded");
  let size = 0;
  for (const arg of args) { if (typeof arg !== "string" || arg.includes("\0")) usage("invalid Git argument"); size += Buffer.byteLength(arg); if (size > GIT_LIMITS.maxArgumentBytes) usage("Git argument byte limit exceeded"); }
  let offset = 0, cwdOptions = 0, literal = false;
  while (offset < args.length && args[offset]!.startsWith("-")) {
    const flag = args[offset++]!;
    if (flag === "--no-pager") continue;
    if (flag === "--literal-pathspecs") { literal = true; continue; }
    if (flag === "-C") { if (++cwdOptions > 8 || args[offset] === undefined) usage("invalid Git -C"); cwd = resolvePath(cwd, args[offset++]!); continue; }
    usage(`unsupported Git global option: ${flag}`);
  }
  const command = args[offset++] ?? "";
  if (!["status", "diff", "log", "show", "rev-parse", "ls-files"].includes(command)) usage(`unsupported Git subcommand: ${command || "(missing)"}`);
  const result: Arguments = { command, cwd, literal, paths: [], operands: [], flags: new Set(), untracked: "normal", context: 3, count: undefined, format: undefined };
  let paths = false;
  const value = (attached?: string): string => { const input = attached ?? args[offset++]; if (input === undefined) usage("missing Git option value"); return input; };
  const integer = (text: string, maximum: number): number => { if (!/^(0|[1-9][0-9]{0,6})$/.test(text) || Number(text) > maximum) usage("invalid Git numeric option"); return Number(text); };
  for (; offset < args.length;) {
    const arg = args[offset++]!;
    if (arg === "--" && !paths) { paths = true; continue; }
    if (paths) {
      if (["status", "diff", "ls-files"].includes(command)) result.paths.push(arg);
      else result.operands.push(arg);
      continue;
    }
    if (!arg.startsWith("-")) {
      if (command === "status" || command === "ls-files") result.paths.push(arg);
      else result.operands.push(arg);
      continue;
    }
    const allowed: Record<string, readonly string[]> = {
      "rev-parse": ["--show-toplevel", "--absolute-git-dir", "--is-inside-work-tree", "--is-bare-repository", "--verify"],
      "ls-files": ["--cached", "--stage", "-s", "-z"],
      status: ["--short", "-s", "--porcelain", "--porcelain=v1", "-z", "--no-renames"],
      diff: ["--cached", "--staged", "--name-only", "--name-status", "-z", "--exit-code", "--quiet", "-p", "--patch", "--full-index", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color"],
      log: ["--first-parent", "--oneline"], show: ["--no-patch"],
    };
    if (allowed[command]!.includes(arg)) { result.flags.add(arg); if (arg === "--oneline") result.format = "oneline"; continue; }
    if (command === "status" && (arg === "-u" || arg.startsWith("-u") || arg.startsWith("--untracked-files="))) {
      const kind = arg === "-u" ? "all" : arg.startsWith("--") ? arg.slice(18) : arg.slice(2);
      if (!["no", "normal", "all"].includes(kind)) usage("invalid Git untracked mode"); result.untracked = kind as Arguments["untracked"]; continue;
    }
    if (command === "diff" && (arg.startsWith("-U") || arg.startsWith("--unified="))) { result.context = integer(value(arg.startsWith("-U") ? arg.slice(2) || undefined : arg.slice(10)), 100); continue; }
    if (command === "log" && (arg === "-n" || arg.startsWith("-n") || arg.startsWith("--max-count="))) { result.count = integer(value(arg.startsWith("--") ? arg.slice(12) : arg.slice(2) || undefined), GIT_LIMITS.maxCommits); continue; }
    if (["log", "show"].includes(command) && arg.startsWith("--format=")) { const format = arg.slice(9); if (format !== "%H" && format !== "%H %s") usage("unsupported Git format"); result.format = format; continue; }
    usage(`unsupported Git ${command} option: ${arg}`);
  }
  if (command === "status" && !["--short", "-s", "--porcelain", "--porcelain=v1", "-z"].some(flag => result.flags.has(flag))) usage("M1A status requires --short or --porcelain");
  if (command === "log" && (!result.flags.has("--first-parent") || !result.format)) usage("M1A log requires --first-parent and a supported format");
  if (command === "show" && result.flags.has("--no-patch") && !result.format) usage("M1A show --no-patch requires a format");
  if (command === "diff" && result.flags.has("-z") && !result.flags.has("--name-only") && !result.flags.has("--name-status") && !result.flags.has("--quiet")) usage("Git -z requires a name list");
  if (command === "diff" && result.flags.has("--name-only") && result.flags.has("--name-status")) usage("conflicting Git diff output options");
  const maximum = command === "diff" ? 2 : command === "ls-files" || command === "status" ? 0 : 1;
  if (result.operands.length > maximum) usage("too many Git operands");
  if (command === "rev-parse" && (result.flags.size > 1 || result.operands.length && [...result.flags].some(flag => flag !== "--verify") || !result.flags.size && !result.operands.length || result.flags.has("--verify") && !result.operands.length)) usage("invalid Git rev-parse selection");
  if (command === "show" && result.operands.length !== 1) usage("Git show requires one operand");
  return result;
}

export function pathspecs(parsed: Arguments, root: string | undefined): string[] {
  if (!parsed.paths.length) return [];
  const base = root ?? parsed.cwd;
  return parsed.paths.map(raw => {
    let name = raw, literal = parsed.literal;
    if (!literal && name.startsWith(":(literal)")) { name = name.slice(10); literal = true; }
    if (!name || !literal && /[*?\[\\]|^:/.test(name)) usage("unsupported Git pathspec");
    const absolute = resolvePath(parsed.cwd, name);
    if (absolute !== base && !absolute.startsWith(base + "/")) usage("Git pathspec outside worktree");
    const path = absolute === base ? "" : absolute.slice(base.length + 1);
    if (path) objectPath(path);
    return path;
  });
}

export function selected(path: string, specs: readonly string[]): boolean { return specs.length === 0 || specs.some(spec => !spec || path === spec || path.startsWith(spec + "/")); }

export function quote(path: string): string {
  const bytes = Buffer.from(path);
  if (bytes.every(byte => byte > 32 && byte < 127 && byte !== 34 && byte !== 92)) return path;
  let result = '"';
  const escapes: Record<number, string> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 34: '\\"', 92: "\\\\" };
  for (const byte of bytes) result += escapes[byte] ?? (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\\" + byte.toString(8).padStart(3, "0"));
  return result + '"';
}
