import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { builtInDirectContextExecutors, decoder, encoder, syncCommandEvaluators } from "../internal.js";
import { execute } from "./apply.js";
import { settings, type ApplyPatchCommandsOptions } from "./options.js";

export type { ApplyPatchCommandsOptions, ApplyPatchLimits } from "./options.js";

export function evalSyncApplyPatch(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  if (!readFileSync || !writeFileSync || opArgs.length > 1) return undefined;
  const rawPatch = opArgs.length === 1 ? opArgs[0]! : (inBytes ? decoder.decode(inBytes) : "");
  const lines = rawPatch.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines[lines.length - 1] !== "*** End Patch") {
    return undefined;
  }
  const writes: { path: string; bytes: Uint8Array; summary: string }[] = [];
  let idx = 1;
  while (idx < lines.length - 1) {
    const header = lines[idx]!;
    if (header.startsWith("*** Add File: ")) {
      const target = header.slice("*** Add File: ".length);
      if (!target || target.includes("..")) return undefined;
      idx++;
      const added: string[] = [];
      while (idx < lines.length - 1 && !lines[idx]!.startsWith("*** ")) {
        const l = lines[idx]!;
        if (!l.startsWith("+")) return undefined;
        added.push(l.slice(1));
        idx++;
      }
      writes.push({
        path: target,
        bytes: encoder.encode(added.join("\n") + (added.length ? "\n" : "")),
        summary: `A ${target}\n`,
      });
    } else if (header.startsWith("*** Update File: ")) {
      const target = header.slice("*** Update File: ".length);
      if (!target || target.includes("..")) return undefined;
      const origBytes = readFileSync(target);
      if (!origBytes) return undefined;
      let fileLines = decoder.decode(origBytes).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      idx++;
      if (idx < lines.length - 1 && lines[idx]!.startsWith("*** Move to: ")) return undefined;
      let searchPos = 0;
      while (idx < lines.length - 1 && !lines[idx]!.startsWith("*** ")) {
        if (!lines[idx]!.startsWith("@@")) return undefined;
        idx++;
        const oldChunk: string[] = [];
        const newChunk: string[] = [];
        while (idx < lines.length - 1 && !lines[idx]!.startsWith("@@") && !lines[idx]!.startsWith("*** ")) {
          const hl = lines[idx]!;
          if (hl === "*** End of File") { idx++; break; }
          const prefix = hl[0];
          const content = hl.slice(1);
          if (prefix === " ") { oldChunk.push(content); newChunk.push(content); }
          else if (prefix === "-") { oldChunk.push(content); }
          else if (prefix === "+") { newChunk.push(content); }
          else return undefined;
          idx++;
        }
        let matchIdx = -1;
        for (let c = searchPos; c <= fileLines.length - oldChunk.length; c++) {
          let ok = true;
          for (let j = 0; j < oldChunk.length; j++) {
            if (fileLines[c + j] !== oldChunk[j]) { ok = false; break; }
          }
          if (ok) { matchIdx = c; break; }
        }
        if (matchIdx < 0) return undefined;
        fileLines.splice(matchIdx, oldChunk.length, ...newChunk);
        searchPos = matchIdx + newChunk.length;
      }
      writes.push({
        path: target,
        bytes: encoder.encode(fileLines.join("\n") + "\n"),
        summary: `M ${target}\n`,
      });
    } else {
      return undefined;
    }
  }
  if (writes.length === 0) return undefined;
  for (const w of writes) {
    if (!writeFileSync(w.path, w.bytes)) return undefined;
  }
  return "Success. Updated the following files:\n" + writes.map(w => w.summary).join("");
}

syncCommandEvaluators.evalSyncApplyPatch = evalSyncApplyPatch;

export function createApplyPatchCommand(options: ApplyPatchCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const executeFn = (context: CommandContext) => execute(context, limits);
  builtInDirectContextExecutors.add(executeFn);
  return Object.freeze({ name: "apply_patch", description: "Apply a bounded literal Codex-format patch to the virtual filesystem", execute: executeFn });
}

export function createApplyPatchCommands(options: ApplyPatchCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createApplyPatchCommand(options)]);
}

export function applyPatchCommands(options: ApplyPatchCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createApplyPatchCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "apply-patch-commands",
    setup(host) {
      if (!replace && host.commands.has("apply_patch")) throw new Error("Command already registered: apply_patch");
      for (const definition of definitions) host.commands.register(definition, { replace });
    },
  };
}
