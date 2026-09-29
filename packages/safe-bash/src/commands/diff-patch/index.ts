import { flags } from "./diff-options.js";
import { expandTabs } from "./diff-output.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { diffCommand } from "./diff.js";
import { patchCommand } from "./patch.js";
import type { DiffPatchOptions } from "./shared.js";

export type { DiffPatchOptions } from "./shared.js";

export function createDiffPatchCommands(options: DiffPatchOptions = {}): readonly CommandDefinition[] {
  return [diffCommand(options), patchCommand(options)];
}

export function diffPatchCommands(options: DiffPatchOptions = {}): VirtualShellPlugin {
  return {
    name: "diff-patch-commands",
    setup(host) {
      const definitions = createDiffPatchCommands(options);
      if (!options.replace) for (const command of definitions) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of definitions) host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}

const syncDiffDecoder = new TextDecoder("utf-8", { fatal: false });

function normalizeSyncDiffLines(text: string, opts: ReturnType<typeof flags>): string[] {
  const rawLines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      rawLines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) rawLines.push(text.slice(start));
  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]!;
    if (opts.stripTrailingCr && line.endsWith("\r\n")) {
      line = line.slice(0, -2) + "\n";
    } else if (opts.stripTrailingCr && line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    let body = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (opts.ignoreTabs) body = expandTabs(body);
    if (opts.whitespace !== "exact") {
      body = body.replace(/[ \t\v\f\r]+/gu, opts.whitespace === "all" ? "" : " ");
    }
    if (opts.ignoreTrailing || opts.whitespace !== "exact") {
      body = body.replace(/[ \t\v\f\r]+$/u, "");
    }
    if (opts.ignoreCase) {
      body = body.replace(/[A-Z]/gu, letter => letter.toLowerCase());
    }
    if (opts.ignoreBlank && body === "") continue;
    const suffix = (opts.whitespace !== "exact" || opts.ignoreTrailing || opts.ignoreTabs) ? "" : (line.endsWith("\n") ? "\n" : "");
    out.push(body + suffix);
  }
  return out;
}

export function evalSyncDiff(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let opts: ReturnType<typeof flags>;
  try {
    opts = flags(args);
  } catch {
    return undefined;
  }
  if (
    opts.files.length !== 2 ||
    opts.recursive ||
    opts.paginate ||
    opts.format === "side" ||
    opts.format === "ifdef" ||
    opts.format === "ed" ||
    opts.fromFile !== undefined ||
    opts.toFile !== undefined ||
    opts.ignorePatterns.length > 0 ||
    opts.functions.length > 0 ||
    opts.excludes.length > 0 ||
    opts.excludeFiles.length > 0
  ) {
    return undefined;
  }
  const left = opts.files[0]!;
  const right = opts.files[1]!;
  if (left === "-" && right === "-") return opts.reportSame ? `Files ${opts.labels[0] ?? left} and ${opts.labels[1] ?? right} are identical\n` : "";
  const resolveOperand = (op: string): Uint8Array | undefined => {
    if (op === "-" || op === "/dev/stdin" || op === "/dev/fd/0") return stdinBytes;
    if (!readFile) return undefined;
    return readFile(op);
  };
  const b1 = resolveOperand(left);
  const b2 = resolveOperand(right);
  if (!b1 || !b2) return undefined;

  let same = false;
  if (b1.byteLength === b2.byteLength) {
    same = true;
    for (let i = 0; i < b1.byteLength; i++) {
      if (b1[i] !== b2[i]) {
        same = false;
        break;
      }
    }
  }
  if (!same) {
    if (!opts.ignoreCase && !opts.ignoreTrailing && !opts.ignoreBlank && !opts.ignoreTabs && !opts.stripTrailingCr && opts.whitespace === "exact") {
      return undefined;
    }
    for (let i = 0; i < b1.byteLength; i++) if (b1[i] === 0) return undefined;
    for (let i = 0; i < b2.byteLength; i++) if (b2[i] === 0) return undefined;
    const t1 = syncDiffDecoder.decode(b1);
    const t2 = syncDiffDecoder.decode(b2);
    const l1 = normalizeSyncDiffLines(t1, opts);
    const l2 = normalizeSyncDiffLines(t2, opts);
    if (l1.length !== l2.length) return undefined;
    for (let i = 0; i < l1.length; i++) {
      if (l1[i] !== l2[i]) return undefined;
    }
    same = true;
  }
  return opts.reportSame ? `Files ${opts.labels[0] ?? left} and ${opts.labels[1] ?? right} are identical\n` : "";
}
