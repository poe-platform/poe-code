import { modeChange } from "safe-bash-io-engine/commands/mode-change";
export { modeChange } from "safe-bash-io-engine/commands/mode-change";
import { bindConditionalMutation } from "@poe-code/safe-fs/runtime-core";
import { creationUmask } from "safe-bash-contracts/runtime-control";
import { FsError, type ChmodOptions } from "safe-bash-contracts";
import { codeOf, diagnostic, options, pathOf, requireOperands, syncCommandEvaluators, UsageError, value } from "safe-bash-io-engine/internal";
import { gnuInformationSync } from "safe-bash-io-engine/gnu-information";
import { MetadataBudget, metadataCommand, permissionString, settings, type MetadataCommandsOptions } from "safe-bash-metadata-engine";

export function createChmodCommand(configuration: MetadataCommandsOptions = {}) {
  const configured = settings(configuration);
  const configuredUmask = configuration.umask === undefined ? undefined : configured.umask;
  return metadataCommand("chmod", async context => {
    const budget = new MetadataBudget(context, configured.limits);
    const modeOptions: string[] = [];
    let ended = false, referenceValue = false;
    const args = context.args.flatMap(argument => {
      if (referenceValue) { referenceValue = false; return [argument]; }
      if (argument === "--") ended = true;
      if (ended) return [argument];
      if (argument === "--reference") referenceValue = true;
      if (argument.startsWith("-") && argument.length > 1 && "rwxXstugo01234567".includes(argument[1]!)) {
        modeOptions.push(argument);
        return [];
      }
      return [argument];
    });
    const parsed = options(args, "Rvcf", { recursive: "R", verbose: "v", changes: "c", silent: "f", quiet: "f", reference: "reference:" });
    const reference = value(parsed, "reference");
    if (reference !== undefined && modeOptions.length) throw new UsageError("cannot combine mode and --reference options");
    requireOperands(parsed.operands, reference === undefined && !modeOptions.length ? 2 : 1);
    const mode = modeOptions.length ? modeOptions.join(",") : reference === undefined ? parsed.operands.shift()! : undefined;
    const mask: unknown = configuredUmask ?? Reflect.get(context.fs, creationUmask);
    const activeUmask = typeof mask === "number" ? mask : configured.umask;
    const change = mode === undefined ? undefined : modeChange(mode, activeUmask);
    const paths = parsed.operands;
    if (context.fs.capabilities.readOnly) throw new FsError("EROFS", { syscall: "chmod" });
    if (!context.fs.chmod || context.fs.capabilities.permissions === false) throw new FsError("ENOTSUP", { syscall: "chmod" });
    const referenceMode = reference === undefined ? undefined : (await context.fs.stat(pathOf(context, reference), { signal: context.signal })).mode & 0o7777;
    let exitCode = 0;
    const visit = async (path: string, display: string, depth: number, top: boolean): Promise<void> => {
      await budget.step(depth);
      const link = await context.fs.lstat(path, { signal: context.signal });
      if (link.type === "symlink" && !top) return;
      const target = link.type === "symlink" ? await context.fs.realpath(path, { signal: context.signal }) : path;
      const stat = link.type === "symlink" ? await context.fs.stat(target, { signal: context.signal }) : link;
      const mode = referenceMode ?? change!(stat);
      if (parsed.flags.has("R") && stat.type === "directory" && await context.fs.realpath(target, { signal: context.signal }) === "/") throw new FsError("EBUSY", { syscall: "chmod", path, message: "refusing recursive mode changes at virtual root" });
      const canonicalTarget = await context.fs.realpath(target, { signal: context.signal });
      const apply = async () => {
        context.signal.throwIfAborted();
        const currentCanonical = await context.fs.realpath(target, { signal: context.signal });
        if (currentCanonical !== canonicalTarget) throw new FsError("EIO", { syscall: "chmod", path, message: "path changed during permission update" });
        const fresh = await context.fs.lstat(canonicalTarget, { signal: context.signal });
        if (fresh.type === "symlink" || fresh.type !== stat.type || stat.ino !== undefined && fresh.ino !== stat.ino || stat.dev !== undefined && fresh.dev !== stat.dev) throw new FsError("EIO", { syscall: "chmod", path, message: "path changed during permission update" });
        const capabilities = await context.fs.capabilitiesFor?.(canonicalTarget, { signal: context.signal, conditionalChmod: true }) ?? context.fs.capabilities;
        context.signal.throwIfAborted();
        if (capabilities.conditionalChmod !== true) throw new FsError("ENOTSUP", { syscall: "chmod", path, message: "conditional permission updates are not supported" });
        const parentPath = canonicalTarget.slice(0, canonicalTarget.lastIndexOf("/")) || "/";
        const ancestorPaths: string[] = ["/"];
        if (parentPath !== "/") {
          let prefix = "";
          for (const part of parentPath.split("/").filter(Boolean)) {
            prefix += `/${part}`;
            ancestorPaths.push(prefix);
          }
        }
        const ancestors = await Promise.all(ancestorPaths.map(async entryPath => ({
          path: entryPath,
          stat: await context.fs.lstat(entryPath, { signal: context.signal }),
        })));
        const parentStat = ancestors.at(-1)!.stat;
        const mutation: ChmodOptions = { signal: context.signal, parent: parentStat, expected: fresh, ancestors };
        await bindConditionalMutation(fresh.identityScope, { path: canonicalTarget, parent: parentStat, expected: fresh, ancestors }, () =>
          context.fs.chmod!(canonicalTarget, mode, mutation),
        );
        if (parsed.flags.has("v") || parsed.flags.has("c") && mode !== (stat.mode & 0o7777)) {
          await budget.output(`mode of '${display}' ${mode === (stat.mode & 0o7777) ? "retained as" : "changed from " + (stat.mode & 0o7777).toString(8).padStart(4, "0") + " (" + permissionString(stat.mode, stat.type).slice(1) + ") to"} ${mode.toString(8).padStart(4, "0")} (${permissionString(mode, stat.type).slice(1)})\n`);
        }
      };
      const deferred = stat.type === "directory" && parsed.flags.has("R") && (stat.mode & 0o777 & ~mode) !== 0;
      if (!deferred) await apply();
      if (stat.type === "directory" && parsed.flags.has("R")) {
        const entries = await context.fs.readdir(target, { signal: context.signal,
          ...(Number.isFinite(budget.remainingEntries) ? { maxEntries: budget.remainingEntries } : {}) });
        if (entries.length > budget.remainingEntries) throw new FsError("EFBIG", { message: "metadata traversal limit exceeded" });
        for (const entry of entries) {
          if (!entry.name || entry.name === "." || entry.name === ".." || entry.name.includes("/") || entry.name.includes("\0")) throw new FsError("EIO", { message: "invalid directory entry" });
          try { await visit(`${target.replace(/\/$/u, "")}/${entry.name}`, `${display.replace(/\/$/u, "")}/${entry.name}`, depth + 1, false); }
          catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "EFBIG") throw error; exitCode = 1; if (!parsed.flags.has("f")) await diagnostic(context, error); }
        }
      }
      if (deferred) await apply();
    };
    for (const operand of paths) {
      try { await visit(pathOf(context, operand), operand, 0, true); }
      catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "EFBIG") throw error; exitCode = 1; if (!parsed.flags.has("f")) await diagnostic(context, error); }
    }
    return { exitCode };
  });
}


export function evalSyncChmod(
  opArgs: readonly string[],
  umask: number,
  chmodNodeSync?: (filePath: string, change: (stat: { type: "file" | "directory" | "symlink"; mode: number }) => number) => boolean,
): string | undefined {
  const gnuInfo = gnuInformationSync("chmod", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  if (!chmodNodeSync) return undefined;
  try {
    const modeOptions: string[] = [];
    let ended = false;
    let referenceValue = false;
    const args: string[] = [];
    for (const argument of opArgs) {
      if (referenceValue) { referenceValue = false; args.push(argument); continue; }
      if (argument === "--") { ended = true; args.push(argument); continue; }
      if (!ended && argument === "--reference") { referenceValue = true; args.push(argument); continue; }
      if (!ended && argument.startsWith("-") && argument.length > 1 && "rwxXstugo01234567".includes(argument[1]!)) {
        modeOptions.push(argument);
        continue;
      }
      args.push(argument);
    }
    const parsed = options(args, "vcf", { verbose: "v", changes: "c", silent: "f", quiet: "f", reference: "reference:" });
    const reference = value(parsed, "reference");
    if (reference !== undefined && modeOptions.length) return undefined;
    const minOps = reference !== undefined || modeOptions.length ? 1 : 2;
    if (parsed.operands.length < minOps) return undefined;
    let referenceMode: number | undefined;
    if (reference !== undefined) {
      if (/(?:^|\/)((?!\.\.?(?:\/|$))[^/]+)\/\.\.(?:\/|$)/u.test(reference)) return undefined;
      let refType = "";
      if (!chmodNodeSync(reference, stat => { refType = stat.type; referenceMode = stat.mode & 0o7777; return stat.mode; }) || referenceMode === undefined || (reference.endsWith("/") && refType !== "directory")) {
        return undefined;
      }
    }
    const mode = modeOptions.length ? modeOptions.join(",") : reference === undefined ? parsed.operands.shift()! : undefined;
    const change = mode === undefined ? undefined : modeChange(mode, umask);
    for (const op of parsed.operands) {
      if (/(?:^|\/)((?!\.\.?(?:\/|$))[^/]+)\/\.\.(?:\/|$)/u.test(op)) return undefined;
      let opType = "";
      if (!chmodNodeSync(op, stat => { opType = stat.type; return stat.mode; }) || (op.endsWith("/") && opType !== "directory")) return undefined;
    }
    let out = "";
    for (const op of parsed.operands) {
      let line = "";
      const ok = chmodNodeSync(op, stat => {
        const oldMode = stat.mode & 0o7777;
        const nextMode = (referenceMode ?? change!(stat)) & 0o7777;
        if (parsed.flags.has("v") || (parsed.flags.has("c") && nextMode !== oldMode)) {
          line = `mode of '${op}' ${nextMode === oldMode ? "retained as" : "changed from " + oldMode.toString(8).padStart(4, "0") + " (" + permissionString(oldMode, stat.type).slice(1) + ") to"} ${nextMode.toString(8).padStart(4, "0")} (${permissionString(nextMode, stat.type).slice(1)})\n`;
        }
        return nextMode;
      });
      if (!ok) return undefined;
      out += line;
    }
    return out;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncChmod = evalSyncChmod;
