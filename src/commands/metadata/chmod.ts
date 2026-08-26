import { FsError, type FileStat } from "../../contracts/index.js";
import { codeOf, diagnostic, options, pathOf, requireOperands, UsageError, value } from "../internal.js";
import { MetadataBudget, metadataCommand, permissionString, settings, type MetadataCommandsOptions } from "./internal.js";

type ModeChange = (stat: FileStat) => number;

function modeChange(text: string, umask: number): ModeChange {
  const numeric = /^([+=-]?)([0-7]+)$/u.exec(text);
  if (numeric) {
    const bits = Number.parseInt(numeric[2]!, 8);
    if (bits > 0o7777) throw new UsageError(`invalid mode: '${text}'`);
    return stat => {
      const current = stat.mode & 0o7777;
      if (numeric[1] === "+") return current | bits;
      if (numeric[1] === "-") return current & ~bits;
      return bits | (stat.type === "directory" && !numeric[1] && numeric[2]!.length < 5 ? current & 0o6000 : 0);
    };
  }
  const clauses = text.split(",").map(clause => {
    const match = /^([ugoa]*)((?:[+=-](?:[rwxXst]*|[ugo]))+)$/u.exec(clause);
    if (!match) throw new UsageError(`invalid mode: '${text}'`);
    const who = match[1]!;
    const operations = [...match[2]!.matchAll(/([+=-])([^+=-]*)/gu)].map(operation => ({ operator: operation[1]!, permissions: operation[2]! }));
    return { who, operations };
  });
  return stat => {
    let current = stat.mode & 0o7777;
    for (const { who, operations } of clauses) {
      const all = !who || who.includes("a");
      const users = (all || who.includes("u") ? 0o4700 : 0) | (all || who.includes("g") ? 0o2070 : 0) | (all || who.includes("o") ? 0o1007 : 0);
      for (const { operator, permissions } of operations) {
        let bits = 0;
        if (/^[ugo]$/u.test(permissions)) {
          const shift = permissions === "u" ? 6 : permissions === "g" ? 3 : 0;
          const copied = current >> shift & 7;
          bits = copied << 6 | copied << 3 | copied;
        } else {
          if (permissions.includes("r")) bits |= 0o444;
          if (permissions.includes("w")) bits |= 0o222;
          if (permissions.includes("x") || permissions.includes("X") && (stat.type === "directory" || (current & 0o111) !== 0)) bits |= 0o111;
          if (permissions.includes("s")) bits |= 0o6000;
          if (permissions.includes("t")) bits |= 0o1000;
        }
        bits &= users;
        if (!who) bits &= ~umask;
        if (operator === "+") current |= bits;
        else if (operator === "-") current &= ~bits;
        else {
          const preserve = stat.type === "directory" && !permissions.includes("s") ? 0o6000 : 0;
          current = current & ~(users & ~preserve) | bits;
        }
      }
    }
    return current;
  };
}

export function createChmodCommand(configuration: MetadataCommandsOptions = {}) {
  const configured = settings(configuration);
  return metadataCommand("chmod", async context => {
    const budget = new MetadataBudget(context, configured.limits);
    const parsed = options(context.args, "Rvcfr:", { recursive: "R", verbose: "v", changes: "c", silent: "f", quiet: "f", reference: "r" });
    const reference = value(parsed, "r");
    requireOperands(parsed.operands, reference === undefined ? 2 : 1);
    const change = reference === undefined ? modeChange(parsed.operands[0]!, configured.umask) : undefined;
    const paths = reference === undefined ? parsed.operands.slice(1) : parsed.operands;
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
      const apply = async () => {
        context.signal.throwIfAborted();
        const fresh = await context.fs.lstat(target, { signal: context.signal });
        if (fresh.type === "symlink" || fresh.type !== stat.type || stat.ino !== undefined && fresh.ino !== stat.ino || stat.dev !== undefined && fresh.dev !== stat.dev) throw new FsError("EIO", { syscall: "chmod", path, message: "path changed during permission update" });
        await context.fs.chmod!(target, mode, { signal: context.signal });
        if (parsed.flags.has("v") || parsed.flags.has("c") && mode !== (stat.mode & 0o7777)) {
          await budget.output(`mode of '${display}' ${mode === (stat.mode & 0o7777) ? "retained as" : "changed from " + (stat.mode & 0o7777).toString(8).padStart(4, "0") + " (" + permissionString(stat.mode, stat.type).slice(1) + ") to"} ${mode.toString(8).padStart(4, "0")} (${permissionString(mode, stat.type).slice(1)})\n`);
        }
      };
      const deferred = stat.type === "directory" && parsed.flags.has("R") && (stat.mode & 0o777 & ~mode) !== 0;
      if (!deferred) await apply();
      if (stat.type === "directory" && parsed.flags.has("R")) {
        const entries = await context.fs.readdir(target, { signal: context.signal });
        if (entries.length > configured.limits.maxEntries) throw new FsError("EFBIG", { message: "metadata traversal limit exceeded" });
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
