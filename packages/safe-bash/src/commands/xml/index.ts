import { parseXmlSteps, XmlLimitError } from "poe-code/safe-fs/core";
import { FsError, getCommandArguments, readBytes, toByteSource, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { writeDiagnostic } from "../../escaping.js";
import { pathOf } from "../internal.js";
import { interruptible } from "../structured/limits.js";
import { XmlBudget, XmlQueryError, XmlQueryLimitError, resolveXmlQueryLimits, type XmlCommandsOptions, type XmlQueryLimits } from "./limits.js";
import { parseQuery, type Query } from "./query.js";
import { evaluate, serialize, stringValue } from "./evaluate.js";

export { defaultXmlQueryLimits } from "./limits.js";
export type { XmlCommandsOptions, XmlQueryLimits } from "./limits.js";

async function argumentsFor(context: CommandContext, budget: XmlBudget): Promise<{ query: Query; file: string | undefined }> {
  if (context.args.length > 5) throw new XmlQueryError("expected one XML input FILE or -", 2);
  const carrier = getCommandArguments(context);
  const args = carrier.args;
  async function admitted(position: number, limit: "maxSourceBytes" | "maxInputBytes"): Promise<string> {
    const text = args[position]!;
    if (text.length > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    const size = shellValueByteLength(carrier.values[position]!);
    if (size > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    for (let offset = 0; offset < size; offset += 1024) await budget.tick(Math.min(1024, size - offset));
    let decoded: string;
    try { decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(carrier.bytes(position)); }
    catch { throw new XmlQueryError("XPath and filenames require valid UTF-8", 2); }
    if (decoded !== text) throw new XmlQueryError("XPath and filenames require lossless UTF-8", 2);
    return decoded;
  }
  let index = 0;
  if (context.command === "xmllint") {
    if (args[index++] !== "--xpath") throw new XmlQueryError("expected --xpath QUERY [FILE|-]", 2);
  }
  if (args[index] === "--") index++;
  const sourceIndex = index++;
  const source = args[sourceIndex];
  if (source === undefined || source.startsWith("-")) throw new XmlQueryError("expected QUERY [FILE|-]", 2);
  if (args[index] === "--") index++;
  const fileIndex = index++;
  const file = args[fileIndex];
  if (index < args.length || file !== undefined && file.startsWith("-") && file !== "-") throw new XmlQueryError("expected one XML input FILE or -", 2);
  const query = await parseQuery(await admitted(sourceIndex, "maxSourceBytes"), budget);
  return { query, file: file === undefined ? undefined : await admitted(fileIndex, "maxInputBytes") };
}

async function input(context: CommandContext, file: string | undefined, budget: XmlBudget): Promise<string> {
  let source: ByteSource = context.stdin;
  if (file !== undefined && file !== "-") {
    const path = pathOf(context, file);
    const capabilities = context.fs.capabilitiesFor
      ? await interruptible(() => context.fs.capabilitiesFor!(path, { signal: context.signal }), context.signal)
      : context.fs.capabilities;
    context.signal.throwIfAborted();
    if (context.fs.readStream && capabilities.streamingRead !== false) source = context.fs.readStream(path, { signal: context.signal });
    else {
      try { source = toByteSource(await interruptible(() => context.fs.readFile(path, { signal: context.signal, maxBytes: budget.limits.maxInputBytes }), context.signal)); }
      catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof FsError && error.code === "EFBIG") throw new XmlQueryLimitError("maxInputBytes");
        throw error;
      }
    }
  }
  const parts: string[] = [];
  let size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of readBytes(source, context.signal)) {
    await budget.tick();
    size += chunk.byteLength;
    if (size > budget.limits.maxInputBytes) throw new XmlQueryLimitError("maxInputBytes");
    // Decode before requesting another chunk; a producer may reuse its backing bytes.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      await budget.tick(Math.min(4096, chunk.length - offset));
      try { parts.push(decoder.decode(chunk.subarray(offset, offset + 4096), { stream: true })); }
      catch { throw new XmlQueryError("XML input must be UTF-8", 1); }
    }
  }
  try { parts.push(decoder.decode()); }
  catch { throw new XmlQueryError("XML input must be UTF-8", 1); }
  return parts.join("");
}

async function execute(context: CommandContext, limits: XmlQueryLimits): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal);
  let outputFailed = false;
  try {
    const options = await argumentsFor(context, budget);
    const source = await input(context, options.file, budget);
    const parser = parseXmlSteps(source, { ...limits, maxContentNodes: limits.maxNodes, expectedEncoding: "UTF-8" });
    let parsed = parser.next();
    try {
      while (!parsed.done) { await budget.tick(parsed.value); parsed = parser.next(); }
    } finally { if (!parsed.done) parser.return(undefined as never); }
    const nodes = await evaluate(options.query, parsed.value, budget);
    async function write(part: string): Promise<void> {
      for (let offset = 0; offset < part.length;) {
        let end = Math.min(offset + 4096, part.length);
        if (end < part.length && part.charCodeAt(end - 1) >= 0xd800 && part.charCodeAt(end - 1) <= 0xdbff) end--;
        await budget.tick(end - offset);
        const slice = part.slice(offset, end);
        const size = Buffer.byteLength(slice);
        if (size > limits.maxOutputBytes - budget.outputBytes) throw new XmlQueryLimitError("maxOutputBytes");
        budget.outputBytes += size;
        try { await writeBytes(context.stdout, Buffer.from(slice), context.signal); }
        catch (error) { outputFailed = true; throw error; }
        offset = end;
      }
    }
    if (options.query.scalar === "count") await write(String(nodes.length));
    else if (options.query.scalar === "boolean") await write(nodes.length ? "true" : "false");
    else if (options.query.scalar === "string") {
      for await (const part of stringValue(nodes[0], budget)) await write(part);
    } else {
      if (!nodes.length) throw new XmlQueryError("XPath set is empty", 11);
      for (const node of nodes) {
        for await (const part of serialize(node, budget)) await write(part);
        await write("\n");
      }
      return { exitCode: 0 };
    }
    await write("\n");
    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    if (outputFailed || error instanceof FsError && error.code === "EPIPE") throw error;
    const status = error instanceof XmlQueryError ? error.status : error instanceof XmlLimitError ? 5
      : error instanceof SyntaxError || error instanceof FsError ? 1 : undefined;
    if (status === undefined) throw error;
    const message = error instanceof Error ? error.message.slice(0, 1000) : "XML query failed";
    await writeDiagnostic(context.stderr, `${context.command}: ${message}\n`, context.signal);
    return { exitCode: status };
  }
}

export function createXmlCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  const limits = resolveXmlQueryLimits(options.limits);
  return ["xq", "xmllint"].map(name => ({ name, execute: context => execute(context, limits) }));
}
export function xmlCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createXmlCommands(options);
  const replace = options.replace ?? false;
  return { name: "xml-commands", setup(host) {
    if (!replace) for (const definition of definitions) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
