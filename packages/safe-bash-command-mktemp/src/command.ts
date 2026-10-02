const mktempEncoder = new TextEncoder();
import { creationUmask } from "safe-bash-contracts/runtime-control";
import { randomInteger } from "safe-bash-metadata-engine/random";
import { FsError, validatePath } from "safe-bash-contracts";
import { codeOf, diagnostic, pathOf, syncCommandEvaluators, UsageError } from "safe-bash-io-engine/internal";
import { gnuInformationSync } from "safe-bash-io-engine/gnu-information";
import { MetadataBudget, metadataCommand, settings, type MetadataCommandsOptions } from "safe-bash-metadata-engine";

function parse(args: readonly string[]) {
  let directory = false;
  let dryRun = false;
  let quiet = false;
  let useTmpdir = false;
  let deprecatedTmpdir = false;
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
        else if (option === "t") { useTmpdir = true; deprecatedTmpdir = true; }
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
  let template = operands[0] ?? "tmp.XXXXXXXXXX";
  if (deprecatedTmpdir && !template.includes("XXX")) template += ".XXXXXXXXXX";
  if (operands.length === 0) useTmpdir = true;
  validatePath(template);
  if (deprecatedTmpdir && template.includes("/")) throw new UsageError("template contains directory separator");
  validatePath(suffix ?? "");
  if (suffix?.includes("/") || suffix !== undefined && !template.endsWith("X")) throw new UsageError("suffix requires a template ending in X and cannot contain '/'");
  const name = template.slice(template.lastIndexOf("/") + 1);
  if (name.length + (suffix?.length ?? 0) > 255 || mktempEncoder.encode(name).byteLength + mktempEncoder.encode(suffix ?? "").byteLength > 255) throw new FsError("ENAMETOOLONG", { path: template });
  const end = name.lastIndexOf("X") + 1;
  let start = end;
  while (start > 0 && name[start - 1] === "X") start--;
  if (end - start < 3) throw new UsageError("template must contain at least three consecutive X characters in its last component");
  if (useTmpdir && template.startsWith("/")) throw new UsageError("template must be relative with --tmpdir/-p");
  const tail = suffix ?? name.slice(end);
  return { directory, dryRun, quiet, useTmpdir, deprecatedTmpdir, tmpdir, template, prefix: template.slice(0, template.length - name.length + start), count: end - start, tail };
}

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function sampleTemplateChars(count: number): string {
  let out = "";
  for (let index = 0; index < count; index++) out += alphabet[randomInteger(alphabet.length)];
  return out;
}

export function evalSyncMktemp(
  opArgs: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  statTypeSync?: (filePath: string) => string | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
  mkdirSync?: (filePath: string) => boolean,
): string | undefined {
  const gnuInfo = gnuInformationSync("mktemp", opArgs);
  if (gnuInfo !== undefined) return gnuInfo;
  try {
    const parsed = parse(opArgs);
    const parent = (parsed.deprecatedTmpdir && env.TMPDIR) || parsed.tmpdir || env.TMPDIR || "/tmp";
    validatePath(parent);
    if (!statTypeSync) return undefined;
    if (parsed.useTmpdir && !parsed.dryRun && statTypeSync(parent || ".") !== "directory") return undefined;
    for (let attempt = 0; attempt < 32; attempt++) {
      const random = sampleTemplateChars(parsed.count);
      const generated = `${parsed.prefix}${random}${parsed.tail}`;
      const display = parsed.useTmpdir ? `${parent.replace(/\/+$/u, "")}/${generated}` : generated;
      if (!parsed.directory && display.endsWith("/")) return undefined;
      if (/(?:^|\/)((?!\.\.?(?:\/|$))[^/]+)\/\.\.(?:\/|$)/u.test(display)) return undefined;
      if (display.includes("/")) {
        const dirPart = display.replace(/\/+$/u, "").slice(0, display.replace(/\/+$/u, "").lastIndexOf("/")) || "/";
        const dirSt = statTypeSync(dirPart);
        if (!parsed.dryRun ? dirSt !== "directory" : (dirSt !== "directory" && dirSt !== "missing")) return undefined;
      }
      const st = statTypeSync(display);
      if (st !== "missing") continue;
      if (!parsed.dryRun) {
        if (parsed.directory) {
          if (!mkdirSync || !mkdirSync(display)) return undefined;
        } else {
          if (!writeFileSync || !writeFileSync(display, new Uint8Array(0))) return undefined;
        }
      }
      return `${display}\n`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncMktemp = evalSyncMktemp;

export function createMktempCommand(configuration: MetadataCommandsOptions = {}) {
  const configured = settings(configuration);
  const configuredUmask = configuration.umask === undefined ? undefined : configured.umask;
  return metadataCommand("mktemp", async context => {
    const budget = new MetadataBudget(context, configured.limits);
    const parsed = parse(context.args);
    const parent = (parsed.deprecatedTmpdir && context.env.TMPDIR) || parsed.tmpdir || context.env.TMPDIR || "/tmp";
    validatePath(parent);
    try {
      if (!parsed.dryRun) {
        if (context.fs.capabilities.readOnly) throw new FsError("EROFS", { syscall: "mktemp" });
      }
      for (let attempt = 0; attempt < configured.limits.maxAttempts; attempt++) {
        await budget.step();
        const random = sampleTemplateChars(parsed.count);
        const generated = `${parsed.prefix}${random}${parsed.tail}`;
        const display = parsed.useTmpdir ? `${parent.replace(/\/+$/u, "")}/${generated}` : generated;
        const path = pathOf(context, display);
        if (mktempEncoder.encode(display).byteLength + 1 > configured.limits.maxOutputBytes) throw new FsError("EFBIG", { message: "temporary pathname output exceeds limit" });
        if (parsed.dryRun) {
          try { await context.fs.lstat(path, { signal: context.signal }); continue; }
          catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) !== "ENOENT") throw error;
          }
        } else {
          const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
          if (capabilities.readOnly === true) throw new FsError("EROFS", { syscall: "mktemp" });
          if (capabilities.permissions !== true) throw new FsError("ENOTSUP", { syscall: "mktemp", message: "private temporary creation requires declared permission support" });
          if (parsed.useTmpdir && parent === "/tmp" && !parsed.tmpdir && !context.env.TMPDIR) {
            try { await context.fs.stat(parent, { signal: context.signal }); }
            catch (error) {
              context.signal.throwIfAborted();
              if (codeOf(error) !== "ENOENT") throw error;
              await context.fs.mkdir(parent, { recursive: true, mode: 0o777, signal: context.signal });
            }
          }
          try {
            const mask: unknown = configuredUmask ?? Reflect.get(context.fs, creationUmask);
            const activeUmask = typeof mask === "number" ? mask : configured.umask;
            const mode = (parsed.directory ? 0o700 : 0o600) & ~activeUmask;
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
