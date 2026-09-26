import {convert, createCiteprocFilterCapability, createJsonFilterCapability, createLuaFilterCapability, resolveConversionArgs, inspectCommand, PandocError, defaultLimits, type CiteprocFilterOptions, type ConversionContext, type FilterCapability} from "safe-bash-command-pandoc";
import {createOutputOperation, getCommandArguments, readBytes, dirname, FsError, type CommandDefinition, type CommandContext, type OutputOperation, type FileStat, type VirtualShellPlugin} from "../../contracts/index.js";
import {writeFileOutput} from "../../contracts/filesystem-output.js";
import {compareObservedEntries, compareCopyIdentity} from "../copy-identity.js";
import {pathOf} from "../internal.js";

export interface PandocCommandsOptions {
  readonly limits?: ConversionContext["limits"];
  readonly filters?: ConversionContext["filters"];
  /** Explicit registered interpreter for local JSON filters, e.g. python3 or node. */
  readonly jsonFilterCommand?: string;
  readonly citeproc?: CiteprocFilterOptions;
  readonly replace?: boolean;
}
const statuses: Readonly<Record<string, number>> = {
  E_FORMAT_REQUIRED: 2, E_FORMAT: 2, E_EXTENSION: 2, E_OPTION: 2, E_METADATA: 2,
  E_CAPABILITY: 3, E_PARSE: 4, E_AST: 4, E_ENCODING: 4,
  E_UNSUPPORTED_FEATURE: 5, E_RESOURCE_DENIED: 6, E_RESOURCE_MISSING: 6,
  E_LIMIT: 7, E_LAYOUT: 8, E_IO: 9, E_CANCELLED: 130
};

async function verifyOutputIdentity(context: CommandContext, owner: OutputOperation, output: string, target: FileStat | null, paths: readonly string[], readsStdin: boolean): Promise<void> {
  const {signal} = owner;
  if (target && readsStdin && context.stdinInput?.stat && compareCopyIdentity(context.stdinInput.stat, target) !== "distinct")
    throw new PandocError("E_IO", "convert", "Stdin/output identity conflicts or is unknown; refusing replacement");
  for (const path of paths) {
    if (path === output) throw new PandocError("E_IO", "convert", "Input and output alias");
    if (!target) continue;
    const observed = await owner.acquire(() => context.fs.stat(path, {signal}), () => {});
    if (await owner.acquire(() => compareObservedEntries(context.fs, path, observed, context.fs, output, target, {signal}), () => {}) !== "distinct")
      throw new PandocError("E_IO", "convert", "Input/output identity conflicts or is unknown; refusing replacement");
  }
}

function parseShebangCommand(bytes: Uint8Array): string | undefined {
  const line = new TextDecoder("utf-8").decode(bytes).split(/\r?\n/, 1)[0] ?? "";
  if (!line.startsWith("#!")) return undefined;
  const tokens = line.slice(2).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  const first = tokens[0]!.split("/").pop()!;
  if (first === "env") {
    const second = tokens.find((token, idx) => idx > 0 && !token.startsWith("-") && !token.includes("="));
    return second?.split("/").pop();
  }
  return first || undefined;
}

/** Explicit opt-in: SDK owns all parsing, validation and document conversion. */
export function createPandocCommand(options: PandocCommandsOptions = {}, hasCommand?: (name: string) => boolean): CommandDefinition {
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("pandoc replace must be boolean");
  const interpreter = options.jsonFilterCommand;
  if (interpreter !== undefined && (typeof interpreter !== "string" || !interpreter || [...interpreter].some(character => character.trim() === "" || character === "/" || character === "\0")))
    throw new TypeError("pandoc jsonFilterCommand must be a registered command name");
  if (interpreter !== undefined && options.filters !== undefined) throw new TypeError("Supply either filters or jsonFilterCommand");
  const limits = {...options.limits};
  const configuredFilters = options.filters;
  const citeprocCapability = createCiteprocFilterCapability(options.citeproc);
  return {name: "pandoc", description: "Convert documents with the original bounded TypeScript SDK", async execute(context) {
    context.signal.throwIfAborted();
    // Enroll the root scope before any invocation-owned I/O. stdout gets its own
    // child scope, so consumer closure cannot cancel a file destination.
    const invocation = createOutputOperation(context, {write: async () => {}});
    const makeJsonCapability = (commandName: string): FilterCapability => createJsonFilterCapability({async run(filter) {
      if (!context.invoke) throw new PandocError("E_CAPABILITY", "convert", "The command host cannot invoke a filter interpreter");
      // Dispatch arguments directly; filter paths never become shell source or interpreter options.
      const result = await context.invoke(commandName, ["--", pathOf(context, filter.path), ...filter.args], {
        stdin: (async function* () {yield filter.stdin;})(), stdinIsDefault: false, stdout: filter.stdout,
        stderr: context.stderr, signal: filter.signal ?? invocation.signal
      });
      return result.exitCode;
    }});
    let stdout: ReturnType<typeof createOutputOperation> | undefined;
    try {
      const carrier = getCommandArguments(context);
      const decoder = new TextDecoder("utf-8", {fatal: true});
      for (let i = 0; i < carrier.args.length; i++) {
        try {if (decoder.decode(carrier.bytes(i)).includes("\0")) throw new Error();}
        catch {throw new PandocError("E_OPTION", "convert", "Arguments must be valid UTF-8 without NUL");}
      }
      const info = inspectCommand(carrier.args);
      if (info !== undefined) {
        stdout = invocation.child(context.stdout);
        await stdout.output.write(new TextEncoder().encode(info));
        return {exitCode: 0};
      }
      const maxBytes = Math.min(limits.inputBytes ?? defaultLimits.inputBytes, context.inputBudget?.maxBytes ?? Infinity);
      let total = 0;
      let readSignal = invocation.signal;
      const files = {
        cwd: context.cwd,
        stdin: context.stdinIsDefault ? [] : context.stdin,
        readFile: async (path: string, _signal: AbortSignal, remainingBytes?: number) => (stdout ?? invocation).acquire(async () => {
          const bound = Math.min(maxBytes, remainingBytes ?? maxBytes);
          const bytes = await context.fs.readFile(pathOf(context, path), Number.isFinite(bound) ? {signal: readSignal, maxBytes: bound} : {signal: readSignal});
          total += bytes.byteLength;
          context.inputBudget?.check(total);
          return bytes;
        }, () => {}),
        // Parsing checks authority without acquiring or opening the destination.
        writeFile: async () => {}
      };
      const luaCapability = createLuaFilterCapability({readFile: (path, signal) => files.readFile(path, signal ?? readSignal)});
      const resolveJsonInterpreter = async (filterPath: string): Promise<string | undefined> => {
        if (!context.invoke || !hasCommand) return undefined;
        const lower = filterPath.toLowerCase();
        const extCandidates = lower.endsWith(".py") ? ["python3", "python"]
          : lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".mjs") ? ["node"]
          : lower.endsWith(".sh") ? ["sh", "bash"] : [];
        const matchedExt = extCandidates.find(candidate => hasCommand(candidate));
        if (matchedExt) return matchedExt;
        if (!["python3", "python", "node", "sh", "bash"].some(candidate => hasCommand(candidate))) return undefined;
        try {
          const head = await context.fs.readFile(pathOf(context, filterPath), {signal: readSignal, maxBytes: 256});
          const shebangCmd = parseShebangCommand(head);
          if (shebangCmd && hasCommand(shebangCmd)) return shebangCmd;
        } catch {
          return undefined;
        }
        return undefined;
      };
      const defaultFilters: FilterCapability = {
        async supports(request) {
          if (request.kind === "lua" || request.kind === "citeproc") return true;
          return (await resolveJsonInterpreter(request.path)) !== undefined;
        },
        async apply(document, request, filterContext) {
          if (request.kind === "lua") return luaCapability.apply(document, request, filterContext);
          if (request.kind === "citeproc") return citeprocCapability.apply(document, request, filterContext);
          const resolved = await resolveJsonInterpreter(request.path);
          if (!resolved) throw new PandocError("E_CAPABILITY", "convert", "Filter capability does not support json processing");
          return makeJsonCapability(resolved).apply(document, request, filterContext);
        }
      };
      const filters = interpreter !== undefined ? makeJsonCapability(interpreter) : (configuredFilters ?? defaultFilters);
      const parsed = await resolveConversionArgs(carrier.args, files, invocation.signal, {limits: {...limits, inputBytes: maxBytes}});
      const protectedInputs = [...(parsed.operands ?? []), ...(parsed.options.metadataFiles ?? []), ...(parsed.options.pdfFonts ?? []), ...(parsed.options.template ? [parsed.options.template] : []), ...(parsed.options.includeInHeader ?? []), ...(parsed.options.includeBeforeBody ?? []), ...(parsed.options.includeAfterBody ?? [])];
      const protectedPaths = [...parsed.defaultsPaths.map(path => pathOf(context, path)), ...protectedInputs.filter(input => input.source && !("chunks" in input && input.chunks === files.stdin)).map(input => pathOf(context, input.source!))];
      const readsStdin = parsed.operands === undefined || parsed.operands.some(input => "chunks" in input && input.chunks === files.stdin);
      const destination = parsed.destination === undefined ? undefined : pathOf(context, parsed.destination);
      let expected: FileStat | null = null;
      let parent: FileStat | undefined;
      if (destination !== undefined) {
        const capabilities = await invocation.acquire(async () => await context.fs.capabilitiesFor?.(destination, {signal: invocation.signal}) ?? context.fs.capabilities, () => {});
        if (!capabilities.atomicFileMutation || !context.fs.writeFileConditional || capabilities.write === false || capabilities.readOnly)
          throw new PandocError("E_CAPABILITY", "convert", "Command -o requires atomic conditional file publication on this provider");
        try {expected = await invocation.acquire(() => context.fs.lstat(destination, {signal: invocation.signal}), () => {});}
        catch (error) {if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;}
        if (expected && expected.type !== "file") throw new PandocError("E_IO", "convert", "Output must be a regular file; symlinks are refused");
        await verifyOutputIdentity(context, invocation, destination, expected, protectedPaths, readsStdin);
        parent = await invocation.acquire(() => context.fs.stat(dirname(destination), {signal: invocation.signal}), () => {});
      } else {
        stdout = invocation.child(context.stdout);
        if (context.stdoutFile) {
          const path = context.stdoutFile.path;
          const target = await stdout.acquire(() => context.fs.stat(path, {signal: stdout!.signal}), () => {});
          await verifyOutputIdentity(context, stdout, path, target, protectedPaths, readsStdin);
        }
      }
      const signal = stdout?.signal ?? invocation.signal;
      readSignal = signal;
      const inputs = (parsed.operands ?? [{chunks: files.stdin}]).map(input => "chunks" in input ? {...input, chunks: (async function* () {
        const source = (async function* () {yield* input.chunks;})();
        for await (const chunk of readBytes(source, signal)) {
          if (input.chunks === files.stdin) {
            total += chunk.byteLength;
            context.inputBudget?.check(total);
          }
          yield chunk;
        }
      })()} : input);
      const owner = stdout ?? invocation;
      const resourceFiles = {
        lstat: (path: string) => owner.acquire(() => context.fs.lstat(path, {signal}), () => {}),
        readFile: (path: string, supplied?: {maxBytes?: number}) => owner.acquire(async () => {
          const bound = Math.min(supplied?.maxBytes ?? defaultLimits.resourceBytes, maxBytes);
          const bytes = await context.fs.readFile(path, Number.isFinite(bound) ? {signal, maxBytes: bound} : {signal});
          total += bytes.byteLength;
          context.inputBudget?.check(total);
          return bytes;
        }, () => {}),
        mkdir: (path: string, supplied?: {recursive?: boolean}) => owner.acquire(() => context.fs.mkdir(path, {signal, ...(supplied?.recursive === undefined ? {} : {recursive: supplied.recursive})}), () => {}),
        writeFile: (path: string, bytes: Uint8Array, supplied?: {flag?: "wx"}) => owner.acquire(() => writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, {signal, ...(supplied?.flag === undefined ? {} : {flag: supplied.flag})})), () => {})
      };
      const result = await convert(inputs, parsed.options, {limits: parsed.limits, signal,
        resourceFiles, resourceCwd: context.cwd, ...(filters === undefined ? {} : {filters})});
      for (const diagnostic of result.diagnostics) await context.stderr.write(new TextEncoder().encode(`${diagnostic.code}: ${diagnostic.message}\n`));
      const bytes = result.kind === "binary" ? result.bytes : new TextEncoder().encode(result.text);
      signal.throwIfAborted();
      if (destination !== undefined) await invocation.acquire(() => writeFileOutput(context, bytes, async data => {
        await context.fs.writeFileConditional!(destination, data, {expected, parent: parent!, signal});
      }), () => {});
      else await stdout!.output.write(bytes);
      signal.throwIfAborted();
      return {exitCode: 0};
    } catch (error) {
      context.signal.throwIfAborted();
      stdout?.signal.throwIfAborted();
      if (!(error instanceof PandocError) && !(error instanceof FsError)) throw error;
      const code = error instanceof PandocError ? error.code : "E_IO";
      await context.stderr.write(new TextEncoder().encode(`${code}: ${error.message}\n`));
      return {exitCode: statuses[code] ?? 2};
    } finally {await invocation.close();}
  }};
}
export function createPandocCommands(options: PandocCommandsOptions = {}): readonly CommandDefinition[] {
  return [createPandocCommand(options)];
}
export function pandocCommands(options: PandocCommandsOptions = {}): VirtualShellPlugin {
  let checkCommand: ((name: string) => boolean) | undefined;
  const commands = [createPandocCommand(options, name => checkCommand?.(name) ?? false)], replace = options.replace ?? false;
  return {name: "pandoc-commands", setup(host) {
    checkCommand = name => host.commands.has(name);
    if (!replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, {replace});
  }};
}
