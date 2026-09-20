import {convert, parseConversionArgs, inspectCommand, PandocError, defaultLimits, type ConversionContext} from "@poe-code/pandoc";
import {createOutputOperation, getCommandArguments, readBytes, dirname, FsError, type CommandDefinition, type CommandContext, type OutputOperation, type FileStat, type VirtualShellPlugin} from "../../contracts/index.js";
import {writeFileOutput} from "../../contracts/filesystem-output.js";
import {compareObservedEntries, compareCopyIdentity} from "../copy-identity.js";
import {pathOf} from "../internal.js";

export interface PandocCommandsOptions {
  readonly limits?: ConversionContext["limits"];
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

/** Explicit opt-in: SDK owns all parsing, validation and document conversion. */
export function createPandocCommand(options: PandocCommandsOptions = {}): CommandDefinition {
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("pandoc replace must be boolean");
  const limits = {...options.limits};
  return {name: "pandoc", description: "Convert documents with the original bounded TypeScript SDK", async execute(context) {
    context.signal.throwIfAborted();
    // Enroll the root scope before any invocation-owned I/O. stdout gets its own
    // child scope, so consumer closure cannot cancel a file destination.
    const invocation = createOutputOperation(context, {write: async () => {}});
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
        readFile: async (path: string) => (stdout ?? invocation).acquire(async () => {
          const bytes = await context.fs.readFile(pathOf(context, path), {signal: readSignal, maxBytes});
          total += bytes.byteLength;
          context.inputBudget?.check(total);
          return bytes;
        }, () => {}),
        // Parsing checks authority without acquiring or opening the destination.
        writeFile: async () => {}
      };
      const parsed = parseConversionArgs(carrier.args, files, invocation.signal);
      const protectedInputs = [...(parsed.operands ?? []), ...(parsed.options.metadataFiles ?? []), ...(parsed.options.pdfFonts ?? [])];
      const protectedPaths = protectedInputs.filter(input => input.source && !("chunks" in input && input.chunks === files.stdin)).map(input => pathOf(context, input.source!));
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
          const bytes = await context.fs.readFile(path, {signal, maxBytes: Math.min(supplied?.maxBytes ?? defaultLimits.resourceBytes, maxBytes)});
          total += bytes.byteLength;
          context.inputBudget?.check(total);
          return bytes;
        }, () => {}),
        mkdir: (path: string, supplied?: {recursive?: boolean}) => owner.acquire(() => context.fs.mkdir(path, {signal, ...(supplied?.recursive === undefined ? {} : {recursive: supplied.recursive})}), () => {}),
        writeFile: (path: string, bytes: Uint8Array, supplied?: {flag?: "wx"}) => owner.acquire(() => writeFileOutput(context, bytes, data => context.fs.writeFile(path, data, {signal, ...(supplied?.flag === undefined ? {} : {flag: supplied.flag})})), () => {})
      };
      const result = await convert(inputs, parsed.options, {limits: {...limits, inputBytes: maxBytes}, signal,
        resourceFiles, resourceCwd: context.cwd});
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
  const commands = createPandocCommands(options), replace = options.replace ?? false;
  return {name: "pandoc-commands", setup(host) {
    if (!replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    for (const command of commands) host.commands.register(command, {replace});
  }};
}
