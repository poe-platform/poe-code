import { renderRtfSync, type UnrtfOptions } from "safe-bash-command-unrtf";
export * from "safe-bash-command-unrtf";

const syncUnrtfSignal = new AbortController().signal;
const syncUnrtfDecoder = new TextDecoder("utf-8", { fatal: false });
const unrtfCache = new Map<string, string>();

export function evalSyncUnrtf(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let format: "text" | "html" | "latex" = "html";
  let profile: UnrtfOptions["profile"];
  let quiet: boolean | undefined;
  let noremap: boolean | undefined;
  let file: string | undefined;
  let literal = false;
  for (let i = 0; i < opArgs.length; i++) {
    const arg = opArgs[i]!;
    if (literal) {
      if (file !== undefined) return undefined;
      file = arg;
    } else if (arg === "--") literal = true;
    else if (arg === "--text") format = "text";
    else if (arg === "--html") format = "html";
    else if (arg === "--latex") format = "latex";
    else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length) as UnrtfOptions["profile"];
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--noremap") noremap = true;
    else if (arg === "--nopict" || arg === "-n") continue;
    else if (arg.startsWith("-")) return undefined;
    else {
      if (file !== undefined) return undefined;
      file = arg;
    }
  }
  let srcBytes = inBytes;
  if (file !== undefined) {
    if (!readFileSync || file.includes("\0")) return undefined;
    srcBytes = readFileSync(file) ?? readFileSync(file + ".rtf");
  }
  if (!srcBytes || srcBytes.byteLength === 0 || srcBytes.byteLength > 16384) return undefined;
  const cacheKey = `${format}|\x00${profile ?? ""}|\x00${quiet ? 1 : 0}|\x00${noremap ? 1 : 0}|\x00${syncUnrtfDecoder.decode(srcBytes)}`;
  const cached = unrtfCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    let out = renderRtfSync(srcBytes, {
      format,
      signal: syncUnrtfSignal,
      ...(quiet === undefined ? {} : { quiet }),
      ...(noremap === undefined ? {} : { noremap }),
      ...(profile === undefined ? {} : { profile }),
    });
    if (out.endsWith("\n")) out = out.slice(0, -1);
    if (unrtfCache.size >= 8) unrtfCache.clear();
    unrtfCache.set(cacheKey, out);
    return out;
  } catch {
    return undefined;
  }
}
