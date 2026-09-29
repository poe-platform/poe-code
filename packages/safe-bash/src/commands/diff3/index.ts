import { compareDiff3, diff3DefaultLimits, parseDiff3Arguments } from "safe-bash-command-diff3";
export * from "safe-bash-command-diff3";

let _syncDiff3Signal: AbortSignal | undefined;
const syncDiff3Signal = (): AbortSignal => (_syncDiff3Signal ??= new AbortController().signal);
const syncDiff3Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function evalSyncDiff3(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const options = parseDiff3Arguments([...opArgs], diff3DefaultLimits);
    if (options.information !== undefined || options.files.length !== 3) return undefined;
    const inputs: Uint8Array[] = [];
    let stdinUsed = false;
    for (const file of options.files) {
      let srcBytes: Uint8Array | undefined;
      if (file === "-") {
        if (stdinUsed || !inBytes) return undefined;
        stdinUsed = true;
        srcBytes = inBytes;
      } else {
        if (!readFileSync) return undefined;
        srcBytes = readFileSync(file);
      }
      if (!srcBytes || srcBytes.byteLength > 16384) return undefined;
      inputs.push(srcBytes);
    }
    const rendered = compareDiff3(inputs, options, diff3DefaultLimits, syncDiff3Signal);
    if (rendered.exitCode !== 0 || rendered.stderr.byteLength !== 0) return undefined;
    let out = syncDiff3Decoder.decode(rendered.stdout);
    if (out.endsWith("\n")) out = out.slice(0, -1);
    return out;
  } catch {
    return undefined;
  }
}
