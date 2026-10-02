import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { builtInDirectContextExecutors, isDefaultCommandOptions, decoder, encoder, syncCommandEvaluators } from "safe-bash-io-engine/internal";
import { execute } from "./apply.js";
import { settings, type ApplyPatchCommandsOptions } from "./options.js";

export type { ApplyPatchCommandsOptions, ApplyPatchLimits } from "./options.js";

export function evalSyncApplyPatch(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
  removeFileSync?: (filePath: string) => boolean,
  mkdirSync?: (filePath: string) => boolean,
): string | undefined {
  if (!readFileSync || !writeFileSync || opArgs.length > 1) return undefined;
  const rawPatch = opArgs.length === 1 ? opArgs[0]! : (inBytes ? decoder.decode(inBytes) : "");
  const lines = rawPatch.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines[lines.length - 1] !== "*** End Patch") {
    return undefined;
  }
  const actions: { kind: "write" | "delete" | "move"; path: string; dest?: string; bytes?: Uint8Array; summary: string }[] = [];
  const seenPaths: string[] = [];
  const registerPatchPath = (rawPath: string): boolean => {
    const norm = rawPath.replace(/^\.\/+/u, "").replace(/\/+$/u, "");
    if (!norm) return false;
    for (const prev of seenPaths) {
      if (norm === prev || norm.startsWith(prev + "/") || prev.startsWith(norm + "/")) return false;
    }
    seenPaths.push(norm);
    return true;
  };
  let idx = 1;
  while (idx < lines.length - 1) {
    const header = lines[idx]!;
    if (header.startsWith("*** Add File: ")) {
      const target = header.slice("*** Add File: ".length);
      if (!target || target.includes("..") || !registerPatchPath(target)) return undefined;
      if (readFileSync(target) !== undefined) return undefined;
      idx++;
      const added: string[] = [];
      while (idx < lines.length - 1 && !lines[idx]!.startsWith("*** ")) {
        const l = lines[idx]!;
        if (!l.startsWith("+")) return undefined;
        added.push(l.slice(1));
        idx++;
      }
      actions.push({
        kind: "write",
        path: target,
        bytes: encoder.encode(added.join("\n") + (added.length ? "\n" : "")),
        summary: `A ${target}\n`,
      });
    } else if (header.startsWith("*** Delete File: ")) {
      const target = header.slice("*** Delete File: ".length);
      if (!target || target.includes("..") || !removeFileSync || !registerPatchPath(target)) return undefined;
      if (!readFileSync(target)) return undefined;
      idx++;
      actions.push({
        kind: "delete",
        path: target,
        summary: `D ${target}\n`,
      });
    } else if (header.startsWith("*** Update File: ")) {
      const target = header.slice("*** Update File: ".length);
      if (!target || target.includes("..") || !registerPatchPath(target)) return undefined;
      const origBytes = readFileSync(target);
      if (!origBytes) return undefined;
      if (origBytes.includes(13) || origBytes.includes(0) || (origBytes.length > 0 && origBytes[origBytes.length - 1] !== 10)) {
        return undefined;
      }
      const fileLines = decoder.decode(origBytes).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      idx++;
      let moveDest: string | undefined;
      if (idx < lines.length - 1 && lines[idx]!.startsWith("*** Move to: ")) {
        moveDest = lines[idx]!.slice("*** Move to: ".length);
        if (!moveDest || moveDest.includes("..") || !removeFileSync || !registerPatchPath(moveDest)) return undefined;
        if (readFileSync(moveDest) !== undefined) return undefined;
        idx++;
      }
      let searchPos = 0;
      let hunkCount = 0;
      while (idx < lines.length - 1 && !lines[idx]!.startsWith("*** ")) {
        if (lines[idx] !== "@@") return undefined;
        hunkCount++;
        idx++;
        const oldChunk: string[] = [];
        const newChunk: string[] = [];
        while (idx < lines.length - 1 && !lines[idx]!.startsWith("@@") && !lines[idx]!.startsWith("*** ")) {
          const hl = lines[idx]!;
          if (hl === "*** End of File") return undefined;
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
      if (hunkCount === 0 && !moveDest) return undefined;
      const outBytes = encoder.encode(fileLines.join("\n") + "\n");
      if (moveDest && moveDest !== target) {
        actions.push({
          kind: "move",
          path: target,
          dest: moveDest,
          bytes: outBytes,
          summary: `M ${moveDest}\n`,
        });
      } else {
        actions.push({
          kind: "write",
          path: target,
          bytes: outBytes,
          summary: `M ${target}\n`,
        });
      }
    } else {
      return undefined;
    }
  }
  if (actions.length === 0) return undefined;
  const ensureDir = (filePath: string) => {
    const slash = filePath.lastIndexOf("/");
    if (slash > 0 && mkdirSync) mkdirSync(filePath.slice(0, slash));
  };
  for (const act of actions) {
    if (act.kind === "delete") {
      if (!removeFileSync!(act.path)) return undefined;
    } else if (act.kind === "move") {
      ensureDir(act.dest!);
      if (!writeFileSync(act.dest!, act.bytes!)) return undefined;
      if (!removeFileSync!(act.path)) return undefined;
    } else {
      ensureDir(act.path);
      if (!writeFileSync(act.path, act.bytes!)) return undefined;
    }
  }
  return "Success. Updated the following files:\n" + actions.map(a => a.summary).join("");
}

syncCommandEvaluators.evalSyncApplyPatch = evalSyncApplyPatch;

export function createApplyPatchCommand(options: ApplyPatchCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  const executeFn = (context: CommandContext) => execute(context, limits);
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(executeFn);
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
