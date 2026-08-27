import { randomInt } from "node:crypto";
import { FsError, validatePath } from "../../contracts/index.js";
import { codeOf, diagnostic, pathOf, UsageError } from "../internal.js";
import { MetadataBudget, metadataCommand, settings, type MetadataCommandsOptions } from "./internal.js";

function parse(args: readonly string[]) {
  let directory = false;
  let dryRun = false;
  let quiet = false;
  let useTmpdir = false;
  let tmpdir: string | undefined;
  let suffix: string | undefined;
  let literal = false;
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (literal || argument === "-" || !argument.startsWith("-")) operands.push(argument);
    else if (argument === "--") literal = true;
    else if (argument === "--directory") directory = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--quiet") quiet = true;
    else if (argument === "--tmpdir" || argument.startsWith("--tmpdir=")) {
      useTmpdir = true;
      tmpdir = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : "";
    } else if (argument === "--suffix" || argument.startsWith("--suffix=")) {
      suffix = argument.includes("=") ? argument.slice(argument.indexOf("=") + 1) : args[++index];
      if (suffix === undefined) throw new UsageError("--suffix requires an argument");
    } else if (!argument.startsWith("--")) {
      for (let offset = 1; offset < argument.length; offset++) {
        const option = argument[offset];
        if (option === "d") directory = true;
        else if (option === "u") dryRun = true;
        else if (option === "q") quiet = true;
        else if (option === "p") {
          tmpdir = argument.slice(offset + 1) || args[++index];
          if (tmpdir === undefined) throw new UsageError("-p requires an argument");
          useTmpdir = true;
          break;
        } else throw new UsageError(`unrecognized option '${argument}'`);
      }
    } else throw new UsageError(`unrecognized option '${argument}'`);
  }
  if (operands.length > 1) throw new UsageError("too many templates");
  const template = operands[0] ?? "tmp.XXXXXXXXXX";
  if (operands.length === 0) useTmpdir = true;
  validatePath(template);
  validatePath(suffix ?? "");
  if (suffix?.includes("/") || suffix !== undefined && !template.endsWith("X")) throw new UsageError("suffix requires a template ending in X and cannot contain '/'");
  const name = template.slice(template.lastIndexOf("/") + 1);
  const match = /^(.*?)(X{3,})([^X]*)$/u.exec(name);
  if (!match) throw new UsageError("template must contain at least three consecutive X characters in its last component");
  if (useTmpdir && template.startsWith("/")) throw new UsageError("template must be relative with --tmpdir/-p");
  const tail = suffix ?? match[3]!;
  if (Buffer.byteLength(name + (suffix ?? "")) > 255) throw new FsError("ENAMETOOLONG", { path: template });
  return { directory, dryRun, quiet, useTmpdir, tmpdir, template, prefix: template.slice(0, template.length - name.length) + match[1]!, count: match[2]!.length, tail };
}

export function createMktempCommand(configuration: MetadataCommandsOptions = {}) {
  const configured = settings(configuration);
  return metadataCommand("mktemp", async context => {
    const budget = new MetadataBudget(context, configured.limits);
    const parsed = parse(context.args);
    const parent = parsed.tmpdir || context.env.TMPDIR || "/tmp";
    validatePath(parent);
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    try {
      if (!parsed.dryRun) {
        if (context.fs.capabilities.readOnly) throw new FsError("EROFS", { syscall: "mktemp" });
        if (context.fs.capabilities.permissions !== true) throw new FsError("ENOTSUP", { syscall: "mktemp", message: "private temporary creation requires declared permission support" });
      }
      for (let attempt = 0; attempt < configured.limits.maxAttempts; attempt++) {
        await budget.step();
        let random = "";
        for (let index = 0; index < parsed.count; index++) random += alphabet[randomInt(alphabet.length)];
        const generated = `${parsed.prefix}${random}${parsed.tail}`;
        const display = parsed.useTmpdir ? `${parent.replace(/\/+$/u, "")}/${generated}` : generated;
        const path = pathOf(context, display);
        if (Buffer.byteLength(display) + 1 > configured.limits.maxOutputBytes) throw new FsError("EFBIG", { message: "temporary pathname output exceeds limit" });
        if (parsed.dryRun) {
          try { await context.fs.lstat(path, { signal: context.signal }); continue; }
          catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) !== "ENOENT") throw error;
          }
        } else {
          try {
            const mode = (parsed.directory ? 0o700 : 0o600) & ~configured.umask;
            if (parsed.directory) await context.fs.mkdir(path, { mode, recursive: false, signal: context.signal });
            else await context.fs.writeFile(path, new Uint8Array(), { mode, flag: "wx", signal: context.signal });
          } catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) !== "EEXIST") throw error;
            continue;
          }
        }
        await budget.output(`${display}\n`);
        return { exitCode: 0 };
      }
      throw new FsError("EEXIST", { syscall: "mktemp", message: "temporary name collision limit exceeded" });
    } catch (error) {
      context.signal.throwIfAborted();
      if (!parsed.quiet) await diagnostic(context, error);
      return { exitCode: 1 };
    }
  });
}
