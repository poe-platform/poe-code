import { commandRuntimeIdentity, FsError, type CommandContext, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "../../contracts/index.js";
import { mikeCommandMode, mikeFormat, mikeHelp, mikeUsage, mikeEvalHelp, mikeAllHelp, parseMikeArguments } from "./arguments.js";
import { compileExpression } from "./expression.js";
import { Evaluator } from "./evaluate.js";
import { decodeDocuments, loadYaml, root, scalar, truth, type Candidate, type NativeDocument } from "./nodes.js";
import { encodeNative } from "./native-encoder.js";
import { limitsFor, MikeError, NativeWork, type MikeLimits } from "./native-work.js";
import { publishInPlace } from "./inplace.js";

export interface MikeYqOptions {
  readonly limits?: Partial<MikeLimits>;
  readonly replace?: boolean;
}

function pathOf(context: CommandContext, name: string): string {
  if (name.includes("\0")) throw new MikeError("path contains NUL");
  return name.startsWith("/") ? name : `${context.cwd.endsWith("/") ? context.cwd : `${context.cwd}/`}${name}`;
}

async function runCommand(context: CommandContext, limits: MikeLimits, work: NativeWork): Promise<{ exitCode: number }> {
  const commandMode = mikeCommandMode(context.args);
  try {
    const options = parseMikeArguments(context);
    if (options.help || options.version) {
      const text = options.help ? commandMode === "eval-all" ? mikeAllHelp : commandMode === "eval" ? mikeEvalHelp : mikeHelp : "yq (safe-bash; bounded Mike Farah v4.53.3 profile)\n";
      work.output(Buffer.byteLength(text));
      await work.write(Buffer.from(text));
      return { exitCode: 0 };
    }
    let expression = options.expression;
    const operands = [...options.operands];
    if (expression === undefined && operands.length && operands[0] !== "-") {
      let exists = false;
      try { exists = (await work.track(context.fs.stat(pathOf(context, operands[0]!), { signal: work.signal }))).type !== "directory"; }
      catch (error) { work.assertOpen(); if (!(error instanceof FsError)) throw error; }
      if (!exists) expression = operands.shift();
    }
    expression ??= ".";
    if (options.inplace && (!operands.length || operands[0] === "-")) throw new MikeError("write in place flag only applicable when giving an expression and at least one file");
    if (options.nullInput && operands.length) throw new MikeError("cannot pass files in when using null-input flag");
    const inputOption = mikeFormat(options.input);
    const outputOption = mikeFormat(options.output);
    const inferred = operands[0]?.toLowerCase().endsWith(".json") ? "json" : "yaml";
    const format = inputOption === "auto" ? inferred : inputOption;
    const output = outputOption === "auto" ? inputOption === "auto" ? inferred : "yaml" : outputOption;
    const program = compileExpression(expression);
    const yaml = await work.track(loadYaml());
    work.assertOpen();
    const evaluator = new Evaluator(yaml, work, options.mergeSpec);
    const results: string[] = [];
    let qualified = false;
    let previous: NativeDocument | undefined;
    let original: FileStat | undefined;
    if (options.inplace) { original = await work.track(context.fs.stat(pathOf(context, operands[0]!), { signal: work.signal })); work.assertOpen(); }
    const print = async (candidates: Candidate[]) => {
      for (const candidate of candidates) {
        await work.tick();
        const separator = previous && (previous.fileIndex !== candidate.document.fileIndex || previous.documentIndex !== candidate.document.documentIndex) && output === "yaml" && !options.noDoc ? "---\n" : "";
        const text = separator + await encodeNative(candidate, { format: output, indent: options.indent, unwrap: options.unwrap ?? output === "yaml", compactSequence: options.compactSequence }, yaml, work);
        work.output(Buffer.byteLength(text));
        if (options.inplace) results.push(text);
        else await work.write(Buffer.from(text));
        qualified ||= truth(candidate.node, yaml);
        previous = candidate.document;
      }
    };
    const all: Candidate[] = [];
    if (options.nullInput) {
      const doc = new yaml.Document<import("yaml").Node>();
      doc.contents = scalar(yaml, work, null);
      await print(await evaluator.run(program, [root({ doc, filename: "", fileIndex: 0, documentIndex: 0, format: "yaml" })]));
    } else {
      for (const [fileIndex, filename] of (operands.length ? operands : ["-"]).entries()) {
        let bytes: Uint8Array;
        if (filename === "-") bytes = await work.collect(() => context.stdin);
        else {
          const path = pathOf(context, filename);
          try {
            if (context.fs.readStream) bytes = await work.collect(() => context.fs.readStream!(path, { signal: work.signal }));
            else { bytes = await work.track(context.fs.readFile(path, { signal: work.signal, maxBytes: limits.maxInputBytes })); work.input(bytes.length); }
          } catch (error) {
            work.assertOpen();
            if (error instanceof FsError) {
              const description = { ENOENT: "no such file or directory", EACCES: "permission denied", ENOTDIR: "not a directory", EISDIR: "is a directory", ELOOP: "too many levels of symbolic links", EIO: "input/output error" }[error.code as string];
              if (description) throw new MikeError(`${error.code === "EISDIR" ? "read" : "open"} ${filename}: ${description}`);
            }
            throw error;
          }
        }
        work.assertOpen();
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw new MikeError(`bad file '${filename}': invalid UTF-8`); }
        await decodeDocuments(text, filename, fileIndex, format, yaml, work, async document => {
          if (options.all) { if (all.length >= limits.maxDocuments) throw new MikeError("yq limit exceeded: maxDocuments"); all.push(root(document)); }
          else await print(await evaluator.run(program, [root(document)]));
        });
      }
      if (options.all) await print(await evaluator.run(program, all));
    }
    if (options.exitStatus && !qualified) throw new MikeError("no matches found");
    if (options.inplace) await publishInPlace(pathOf(context, operands[0]!), Buffer.from(results.join("")), original!, work);
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    work.assertOpen();
    if (error instanceof MikeError) {
      const selected = commandMode === "eval-all" ? mikeAllHelp : commandMode === "eval" ? mikeEvalHelp : undefined;
      const usage = selected ? selected.slice(selected.indexOf("Usage:")) + "\n" : mikeUsage;
      const message = `Error: ${error.message}\n${error.usage ? usage : ""}`;
      await work.write(Buffer.from(Buffer.byteLength(message) <= 65536 ? message : "Error: yq diagnostic exceeds safety limit\n"), true);
      return { exitCode: 1 };
    }
    if (error instanceof FsError) {
      await work.write(Buffer.from(Buffer.byteLength(error.message) < 65520 ? `Error: ${error.message}\n` : "Error: yq diagnostic exceeds safety limit\n"), true);
      return { exitCode: 1 };
    }
    throw error;
  }
}

async function execute(context: CommandContext, limits: MikeLimits): Promise<{ exitCode: number }> {
  const work = new NativeWork(context, limits);
  let result: { exitCode: number } | undefined;
  let primary: unknown;
  let failed = false;
  try { result = await runCommand(context, limits, work); }
  catch (error) { failed = true; primary = error; }
  try { await work.close(); }
  catch (error) { if (!failed) { failed = true; primary = error; } }
  context.signal.throwIfAborted();
  if (failed) throw primary;
  return result!;
}

export function createMikeYqCommand(options: MikeYqOptions = {}): CommandDefinition {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "limits" && key !== "replace") || options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("invalid yq options");
  const limits = limitsFor(options.limits);
  return Object.freeze({ name: "yq", runtimeIdentity: commandRuntimeIdentity, async execute(context: CommandContext) { return execute(context, limits); } });
}

export function createMikeYqCommands(options: MikeYqOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createMikeYqCommand(options)]);
}

export function mikeYqCommands(options: MikeYqOptions = {}): VirtualShellPlugin {
  const definitions = createMikeYqCommands(options);
  const replace = options.replace ?? false;
  return Object.freeze({ name: "mike-yq-commands", setup(host) {
    for (const definition of definitions) host.commands.register(definition, { replace });
  } } satisfies VirtualShellPlugin);
}
