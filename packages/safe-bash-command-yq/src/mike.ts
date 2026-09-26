import { decodeFormat, encodeFormat } from "./formats.js";
import { commandRuntimeIdentity, FsError, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { mikeCommandMode, mikeFormat, mikeHelp, mikeUsage, mikeEvalHelp, mikeAllHelp, parseMikeArguments } from "./arguments.js";
import { compileExpression } from "./expression.js";
import { Evaluator } from "./evaluate.js";
import { loadYaml, nodeTag, root, scalar, truth, type Candidate, type YamlModule } from "./nodes.js";
import { writeFileOutputCounted } from "safe-bash-contracts/filesystem-output-budget";
import { encodeNative } from "./native-encoder.js";
import { limitsFor, MikeError, NativeWork, type MikeLimits } from "./native-work.js";
import { captureInPlace, publishInPlace, type InPlaceTarget } from "./inplace.js";

async function encodeNodeInfo(candidate: Candidate, yaml: YamlModule, work: NativeWork): Promise<string> {
  const node = candidate.node;
  const kind = yaml.isMap(node) ? "MappingNode" : yaml.isSeq(node) ? "SequenceNode" : yaml.isAlias(node) ? "AliasNode" : "ScalarNode";
  const styles: Readonly<Record<string, string>> = { QUOTE_DOUBLE: "DoubleQuotedStyle", QUOTE_SINGLE: "SingleQuotedStyle", BLOCK_LITERAL: "LiteralStyle", BLOCK_FOLDED: "FoldedStyle" };
  const style = yaml.isScalar(node) ? styles[node.type ?? ""] ?? "" : !yaml.isAlias(node) && node.flow ? "FlowStyle" : "";
  const location = candidate.isDerived ? undefined : work.positions.get(node);
  const info = {
    kind, style, anchor: "anchor" in node ? node.anchor ?? "" : "", tag: nodeTag(node, yaml),
    value: yaml.isScalar(node) ? String(node.value ?? "") : yaml.isAlias(node) ? node.source : "",
    line: location?.line ?? 0, column: location?.column ?? 0,
  };
  { const t = work.tick(); if (t) await t; }
  work.node(17);
  return yaml.stringify(info, { singleQuote: true }) + "\n";
}

async function writeVerbose(message: string, work: NativeWork): Promise<void> {
  const text = `time=${new Date().toISOString()} level=DEBUG source=safe-bash/yq msg=${JSON.stringify(message)}\n`;
  work.output(Buffer.byteLength(text));
  await work.write(Buffer.from(text), true);
}

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
    work.capturePositions = options.verbose || options.debugNodeInfo;
    if (options.help || options.version) {
      const text = options.help ? commandMode === "eval-all" ? mikeAllHelp : commandMode === "eval" ? mikeEvalHelp : mikeHelp : "yq (safe-bash; bounded Mike Farah v4.53.3 profile)\n";
      work.output(Buffer.byteLength(text));
      await work.write(Buffer.from(text));
      return { exitCode: 0 };
    }
    const readText = async (filename: string): Promise<string> => {
      const path = pathOf(context, filename);
      const bytes = context.fs.readStream
        ? await work.collect(() => context.fs.readStream!(path, { signal: work.signal }))
        : await work.track(context.fs.readFile(path, { signal: work.signal, ...(Number.isFinite(limits.maxInputBytes) ? { maxBytes: limits.maxInputBytes } : {}) }));
      if (!context.fs.readStream) work.input(bytes.length);
      work.assertOpen();
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new MikeError(`bad file '${filename}': invalid UTF-8`); }
    };
    let expression = options.fromFile !== undefined ? await readText(options.fromFile) : options.expression;
    const splitExpression = options.splitFile !== undefined ? await readText(options.splitFile) : options.splitExpression;
    if (options.inplace && splitExpression !== undefined) throw new MikeError("write in place cannot be used with split file");
    const operands = [...options.operands];
    if (expression === undefined && operands.length && operands[0] !== "-") {
      let exists = false;
      if (!options.nullInput && !options.inplace && operands.length === 1) {
        try { exists = (await work.track(context.fs.stat(pathOf(context, operands[0]!), { signal: work.signal }))).type !== "directory"; }
        catch (error) { work.assertOpen(); if (!(error instanceof FsError)) throw error; }
      }
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
    const expressionOptions = { ...options, maxExpressionBytes: limits.maxExpressionBytes, maxExpressionDepth: limits.maxExpressionDepth };
    const program = compileExpression(expression, expressionOptions);
    if (options.verbose) await writeVerbose(`Compiled expression ${expression}; input=${format}; output=${output}`, work);
    const splitProgram = splitExpression !== undefined ? compileExpression(splitExpression, expressionOptions) : undefined;
    const yaml = await work.track(loadYaml());
    work.assertOpen();
    const evaluator = new Evaluator(yaml, work, options.mergeSpec);
    const results: string[] = [];
    let qualified = false;
    const frontMatterBodies = new Map<number, string>();
    let previous: { fileIndex: number; documentIndex: number } | undefined;
    let original: InPlaceTarget | undefined;
    if (options.inplace) { original = await captureInPlace(pathOf(context, operands[0]!), work); }
    const print = async (candidates: Candidate[]) => {
      for (const candidate of candidates) {
        { const t = work.tick(); if (t) await t; }
        // Computed nodes have yq's default output origin, while projections keep their source origin.
        const origin = candidate.isDerived ? { fileIndex: 0, documentIndex: 0 } : candidate.document;
        const separator = !splitProgram && previous && (previous.fileIndex !== origin.fileIndex || previous.documentIndex !== origin.documentIndex) && output === "yaml" && !options.noDoc ? "---\n" : "";
        let encoded = options.debugNodeInfo ? await encodeNodeInfo(candidate, yaml, work) : output !== "yaml" && output !== "json" ? await encodeFormat(candidate, output, yaml, work) : await encodeNative(candidate, { format: output, indent: options.indent, unwrap: options.unwrap ?? output === "yaml", compactSequence: options.compactSequence, prettyPrint: options.prettyPrint, preserveDocumentStart: options.headerPreprocess && !options.noDoc }, yaml, work);
        if (options.verbose) await writeVerbose(`Selected node from ${candidate.document.filename || "stdin"}, document ${candidate.document.documentIndex}: ${await encodeNodeInfo(candidate, yaml, work)}`, work);
        if (options.nulOutput) {
          if (encoded.endsWith("\r\n")) encoded = encoded.slice(0, -2);
          else if (encoded.endsWith("\n") || encoded.endsWith("\r")) encoded = encoded.slice(0, -1);
          if (encoded.includes("\0")) throw new MikeError("can't serialise value because it contains NUL char and you are using NUL separated output");
          encoded += "\0";
        }
        let text = separator + encoded;
        const frontMatterBody = frontMatterBodies.get(candidate.document.fileIndex);
        if (frontMatterBody !== undefined && options.frontMatter === "process") text = `${text}---\n${frontMatterBody}`;
        work.output(Buffer.byteLength(text));
        if (splitProgram) {
          const names = await evaluator.run(splitProgram, [candidate]);
          if (names.length !== 1 || !yaml.isScalar(names[0]!.node) || typeof names[0]!.node.value !== "string") throw new MikeError("split expression must return a string");
          const path = pathOf(context, `${names[0]!.node.value}.${output === "yaml" ? "yml" : output}`);
          const parent = path.slice(0, path.lastIndexOf("/")) || "/";
          await work.track(context.fs.mkdir(parent, { recursive: true, signal: work.signal }));
          work.assertOpen();
          const data = Buffer.from(text);
          await work.track(writeFileOutputCounted({ signal: work.signal, ...(context.registerCleanup ? { registerCleanup: context.registerCleanup } : {}) }, data, async () => {
            await context.fs.writeFile(path, data, { flag: "w", signal: work.signal });
            return data.length;
          }));
          work.assertOpen();
        } else if (options.inplace) results.push(text);
        else await work.write(Buffer.from(text));
        qualified ||= truth(candidate.node, yaml);
        previous = origin;
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
          const path = fileIndex === 0 && original ? original.path : pathOf(context, filename);
          try {
            if (context.fs.readStream) bytes = await work.collect(() => context.fs.readStream!(path, { signal: work.signal }));
            else { bytes = await work.track(context.fs.readFile(path, { signal: work.signal, ...(Number.isFinite(limits.maxInputBytes) ? { maxBytes: limits.maxInputBytes } : {}) })); work.input(bytes.length); }
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
        if (options.frontMatter !== undefined && fileIndex === 0) {
          const firstEnd = text.indexOf("\n");
          let end = firstEnd >= 0 && text.slice(0, firstEnd).trimEnd() === "---" ? firstEnd + 1 : 0;
          while (end < text.length) {
            { const t = work.tick(); if (t) await t; }
            const newline = text.indexOf("\n", end);
            const lineEnd = newline < 0 ? text.length : newline;
            const line = text.slice(end, lineEnd).trimEnd();
            if (line === "---" || line === "...") {
              frontMatterBodies.set(fileIndex, text.slice(newline < 0 ? text.length : newline + 1));
              text = text.slice(0, end);
              break;
            }
            end = newline < 0 ? text.length : newline + 1;
          }
        }
        await decodeFormat(text, filename, fileIndex, options.frontMatter !== undefined && fileIndex === 0 ? "yaml" : format, yaml, work, async document => {
          if (options.verbose) await writeVerbose(`Parsed ${filename}, document ${document.documentIndex}`, work);
          if (options.all) { if (all.length >= limits.maxDocuments) throw new MikeError("yq limit exceeded: maxDocuments"); all.push(root(document)); }
          else await print(await evaluator.run(program, [root(document)]));
        });
      }
      if (options.all) await print(await evaluator.run(program, all));
    }
    if (options.exitStatus && !qualified) throw new MikeError("no matches found");
    if (options.inplace) await publishInPlace(original!, Buffer.from(results.join("")), work);
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    work.assertOpen();
    if (error instanceof MikeError) {
      const selected = commandMode === "eval-all" ? mikeAllHelp : commandMode === "eval" ? mikeEvalHelp : undefined;
      const usage = selected ? selected.slice(selected.indexOf("Usage:")) + "\n" : mikeUsage;
      const message = `Error: ${error.message}\n${error.usage ? usage : ""}`;
      await work.write(Buffer.from(message), true);
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
