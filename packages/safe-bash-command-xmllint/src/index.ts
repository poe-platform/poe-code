import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { createXqCommand } from "safe-bash-command-xq";
import { readXmlChunks, readXmlInput, type XmlCommandRuntime } from "safe-bash-xml-engine/io";
import { parseXmlStream, parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import {
  FsError,
  getCommandArguments,
  writeBytes,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { StoredXmlDocument } from "safe-bash-xml-engine/stored-document";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { prepareDocument, encodeOutput, outputEncoding } from "./output.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { pathOf } from "safe-bash-contracts/path";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { shellValueByteLength } from "safe-bash-contracts/value";
import {
  XmlBudget,
  XmlQueryError,
  XmlQueryLimitError,
  resolveXmlQueryLimits,
  type XmlCommandsOptions,
  type XmlQueryLimits
} from "safe-bash-xml-engine/limits";
import { parseQuery, type Query } from "safe-bash-xml-engine/query";
import { evaluate, evaluateScalar, serialize, serializeSimpleSync } from "safe-bash-xml-engine/evaluate";
import { serializeDocument, type DocumentMode } from "safe-bash-xml-engine/document";

export { defaultXmlQueryLimits } from "safe-bash-xml-engine/limits";
export type { XmlCommandsOptions, XmlQueryLimits } from "safe-bash-xml-engine/limits";
export type { XmlQueryLimits as XmllintLimits, XmlCommandsOptions as XmllintCommandsOptions } from "safe-bash-xml-engine/limits";

async function argumentsFor(
  context: CommandContext,
  budget: XmlBudget
): Promise<{
  query?: Query;
  mode?: DocumentMode | undefined;
  format?: boolean;
  noout?: boolean;
  files: readonly (string | undefined)[];
  output?: string | undefined;
  encoding?: string | undefined;
  noblanks?: boolean;
  nocdata?: boolean;
  recover?: boolean;
}> {
  const carrier = getCommandArguments(context);
  const args = carrier.args;
  async function admitted(
    position: number,
    limit: "maxSourceBytes" | "maxInputBytes"
  ): Promise<string> {
    const text = args[position]!;
    if (text.length > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    const size = shellValueByteLength(carrier.values[position]!);
    if (size > budget.limits[limit]) throw new XmlQueryLimitError(limit);
    for (let offset = 0; offset < size; offset += 1024)
      await budget.tick(Math.min(1024, size - offset));
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        carrier.bytes(position)
      );
    } catch {
      throw new XmlQueryError("XPath and filenames require valid UTF-8", 2);
    }
    if (decoded !== text) throw new XmlQueryError("XPath and filenames require lossless UTF-8", 2);
    return decoded;
  }
  let index = 0;
  let mode: DocumentMode | undefined;
  let noout = false;
  let format = false;
  let xpathIndex: number | undefined;
  let output: string | undefined, encoding: string | undefined;
  let noblanks = false, nocdata = false, recover = false;
  while (index < args.length) {
    const flag = args[index]!;
    { const p = budget.tick(flag.length + 1); if (p) await p; }
    if (flag === "--noout") {
      noout = true;
      index++;
    } else if (flag === "--format") {
      mode ??= "format";
      format = true;
      index++;
    } else if (flag === "--noblanks") {
      noblanks = true; index++;
    } else if (flag === "--nocdata") {
      nocdata = true; index++;
    } else if (flag === "--recover") {
      recover = true; index++;
    } else if (flag === "--output" || flag === "-o" || flag === "--encode") {
      index++;
      if (args[index] === undefined) throw new XmlQueryError(`expected value after ${flag}`, 2);
      const value = await admitted(index++, "maxInputBytes");
      if (flag === "--encode") encoding = outputEncoding(value);
      else output = value;
    } else if (flag === "--c14n" || flag === "--exc-c14n") {
      mode = flag === "--c14n" ? "c14n" : "exc-c14n";
      index++;
    } else if (flag === "--xpath") {
      if (xpathIndex !== undefined) throw new XmlQueryError("expected one --xpath QUERY", 2);
      index++;
      if (args[index] === "--") index++;
      const source = args[index];
      if (source === undefined)
        throw new XmlQueryError("expected QUERY [FILE|-]", 2);
      xpathIndex = index++;
    } else break;
  }
  const literalFiles = args[index] === "--";
  if (literalFiles) index++;
  const files: (string | undefined)[] = [];
  while (index < args.length) {
    const file = args[index]!;
    if (!literalFiles && file.startsWith("-") && file !== "-")
      throw new XmlQueryError("expected XML input FILE or -", 2);
    files.push(await admitted(index++, "maxInputBytes"));
  }
  if (files.length === 0) files.push(undefined);
  if (xpathIndex !== undefined) {
    const query = await parseQuery(await admitted(xpathIndex, "maxSourceBytes"), budget);
    return {
      query, output, encoding, noblanks, nocdata, recover,
      files
    };
  }
  mode ??= "format";
  return {
    mode, output, encoding, noblanks, nocdata, recover,
    format,
    noout,
    files
  };
}

async function executeDocument(
  context: CommandContext,
  limits: XmlQueryLimits,
  runtime: XmlCommandRuntime,
  budget: XmlBudget,
  options: Awaited<ReturnType<typeof argumentsFor>>,
  file: string | undefined
): Promise<{ exitCode: number }> {
  let outputFailed = false;
  let stored: StoredXmlDocument | undefined;
  let completed = false;
  try {
    const recoveryMessages = new Set<string>();
    let parsedRoot: XmlElement;
    if (!options.query && !options.noout && !options.recover && !options.noblanks && !options.nocdata && options.encoding === undefined) {
      stored = await StoredXmlDocument.parse(readXmlChunks(context, file, budget, runtime), context, budget);
      parsedRoot = await stored.node(stored.root) as XmlElement;
    } else if (options.recover) {
      const source = await readXmlInput(context, file, budget, runtime);
      const parser = parseXmlSteps(source, {
        recover: (message: string) => { recoveryMessages.add(message); },
        ...limits,
        maxContentNodes: limits.maxNodes,
        expectedEncoding: "UTF-8"
      });
      let parsed = parser.next();
      try {
        while (!parsed.done) {
          const p = budget.tick(parsed.value);
          if (p) await p;
          parsed = parser.next();
        }
      } finally {
        if (!parsed.done) parser.return(undefined as never);
      }
      parsedRoot = parsed.value;
    } else {
      parsedRoot = await parseXmlStream(readXmlChunks(context, file, budget, runtime), {
        ...limits,
        maxContentNodes: limits.maxNodes,
        expectedEncoding: "UTF-8",
        retainTree: !(options.noout && options.query === undefined)
      }, units => budget.tick(units));
    }
    for (const message of recoveryMessages)
      await runtime.writeDiagnostic(context.stderr, `xmllint: ${message} (recovered)\n`, context.signal);
    const root = await prepareDocument(parsedRoot, options.noblanks ?? false, options.encoding, budget, options.nocdata ?? false);
    const documentOutputStart = budget.outputBytes;
    const fileChunks: Uint8Array[] = [];
    const sink = options.output === undefined || options.query !== undefined ? context.stdout : {
      async write(bytes: Uint8Array) { fileChunks.push(bytes.slice()); }
    };
    let encodingStarted = false;
    async function finish(): Promise<void> {
      await flushWrite();
      if (options.output !== undefined && options.query === undefined && !options.noout) {
        const bytes = new Uint8Array(budget.outputBytes - documentOutputStart);
        let offset = 0;
        for (const chunk of fileChunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const destination = runtime.pathOf(context, options.output);
        try {
          await runtime.interruptible(() => writeFileOutput(context, bytes,
            data => context.fs.writeFile(destination, data, { signal: context.signal })), context.signal);
        } catch (error) {
          if (error instanceof FsError) throw new XmlQueryError(error.message, 6);
          throw error;
        }
      }
    }
    const outBatch = new Uint8Array(16384);
    let outBatchUsed = 0;
    let writesCount = 0;
    async function flushWrite(): Promise<void> {
      if (outBatchUsed > 0) {
        const slice = outBatch.slice(0, outBatchUsed);
        outBatchUsed = 0;
        writesCount++;
        try {
          await writeBytes(sink, slice, context.signal);
        } catch (error) {
          outputFailed = true;
          throw error;
        }
      }
    }
    async function write(part: string): Promise<void> {
      for (let offset = 0; offset < part.length; ) {
        let end = Math.min(offset + 4096, part.length);
        if (
          end < part.length &&
          part.charCodeAt(end - 1) >= 0xd800 &&
          part.charCodeAt(end - 1) <= 0xdbff
        )
          end--;
        { const _p = budget.tick(end - offset); if (_p) await _p; }
        const slice = part.slice(offset, end);
        const bytes = encodeOutput(slice, options.query || options.mode !== "format" ? undefined : options.encoding, !encodingStarted);
        encodingStarted = true;
        const size = bytes.byteLength;
        if (size > limits.maxOutputBytes - budget.outputBytes) {
          await flushWrite();
          throw new XmlQueryLimitError("maxOutputBytes");
        }
        budget.outputBytes += size;
        if (writesCount < 2 || size >= 8192) {
          await flushWrite();
          writesCount++;
          try {
            await writeBytes(sink, bytes, context.signal);
          } catch (error) {
            outputFailed = true;
            throw error;
          }
        } else {
          if (outBatchUsed + size > outBatch.byteLength) await flushWrite();
          outBatch.set(bytes, outBatchUsed);
          outBatchUsed += size;
        }
        offset = end;
      }
    }
    if (options.query === undefined) {
      if (!options.noout && options.mode !== undefined) {
        for await (const part of serializeDocument(
          stored ?? root,
          options.mode,
          budget,
          options.format
        ))
          await write(part);
      }
      await finish();
      completed = true;
      return { exitCode: 0 };
    }
    if (options.query.expression) {
      await write(await evaluateScalar(options.query, root, budget));
      await write("\n");
      await finish();
      completed = true;
      return { exitCode: 0 };
    }
    const nodes = await evaluate(options.query, root, budget);
    if (!nodes.length) throw new XmlQueryError("XPath set is empty", 11);
    let pendingText = "";
    for (const node of nodes) {
      const simple = writesCount >= 2 ? serializeSimpleSync(node, budget) : undefined;
      if (simple !== undefined) {
        pendingText += simple + "\n";
        if (pendingText.length >= 4096) {
          await write(pendingText);
          pendingText = "";
        }
      } else {
        if (pendingText.length > 0) {
          await write(pendingText);
          pendingText = "";
        }
        for await (const part of serialize(node, budget)) await write(part);
        await write("\n");
      }
    }
    if (pendingText.length > 0) await write(pendingText);
    await finish();
    completed = true;
    return { exitCode: 0 };
  } catch (error) {
    return reportError(context, runtime, error, outputFailed);
  } finally {
    if (stored) await stored.close().catch(error => { if (completed) throw error; });
  }
}

async function reportError(
  context: CommandContext,
  runtime: XmlCommandRuntime,
  error: unknown,
  outputFailed = false
): Promise<{ exitCode: number }> {
  context.signal.throwIfAborted();
  if (outputFailed || (error instanceof FsError && error.code === "EPIPE")) throw error;
  const status =
    error instanceof XmlQueryError
      ? error.status
      : error instanceof XmlLimitError
        ? 5
        : error instanceof SyntaxError || error instanceof FsError
          ? 1
          : undefined;
  if (status === undefined) throw error;
  const message = error instanceof Error ? error.message.slice(0, 1000) : "XML query failed";
  await runtime.writeDiagnostic(
    context.stderr,
    `${context.command}: ${message}\n`,
    context.signal
  );
  return { exitCode: status };
}

async function execute(
  context: CommandContext,
  limits: XmlQueryLimits,
  runtime: XmlCommandRuntime
): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal, runtime.yieldTurn);
  let options: Awaited<ReturnType<typeof argumentsFor>>;
  try {
    options = await argumentsFor(context, budget);
  } catch (error) {
    return reportError(context, runtime, error);
  }
  let exitCode = 0;
  for (const file of options.files) {
    const result = await executeDocument(context, limits, runtime, budget, options, file);
    if (result.exitCode !== 0) exitCode = result.exitCode;
    if (exitCode === 5) break;
  }
  return { exitCode };
}

const portableRuntime: XmlCommandRuntime = {
  yieldTurn,
  pathOf,
  writeDiagnostic,
  async interruptible<Result>(operation: () => PromiseLike<Result>, signal: AbortSignal): Promise<Result> {
    signal.throwIfAborted();
    return new Promise<Result>((resolve, reject) => {
      const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
      signal.addEventListener("abort", aborted, { once: true });
      try {
        Promise.resolve(operation()).then(
          result => { signal.removeEventListener("abort", aborted); resolve(result); },
          error => { signal.removeEventListener("abort", aborted); reject(error); }
        );
      } catch (error) { signal.removeEventListener("abort", aborted); reject(error); }
    });
  }
};

export function createXmllintCommand(
  options: XmlCommandsOptions = {},
  runtime: XmlCommandRuntime = portableRuntime
): CommandDefinition {
  const configuredLimits = options.limits;
  const limits = resolveXmlQueryLimits(configuredLimits);
  const definition: CommandDefinition = { name: "xmllint", execute: (context) => execute(context, limits, runtime) };
  if (configuredLimits === undefined) builtInDirectContextExecutors.add(definition.execute);
  return definition;
}

export const xmllintCommand: CommandDefinition = createXmllintCommand();

export function createXmllintCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  return [createXmllintCommand(options)];
}

export function xmllintCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXmllintCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "xmllint-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}


const syncXmlDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type SyncXmlNode =
  | { kind: "document"; children: SyncXmlNode[] }
  | { kind: "element"; value: XmlElement; children: SyncXmlNode[]; attributes: { kind: "attribute"; value: XmlAttribute }[] }
  | { kind: "attribute"; value: XmlAttribute }
  | { kind: Exclude<XmlContent["kind"], "element">; value: Exclude<XmlContent, XmlElement> };

function syncNodeStringValue(node: SyncXmlNode | undefined): string {
  if (!node) return "";
  if (node.kind === "attribute") return node.value.value;
  let out = "";
  const pending: SyncXmlNode[] = [node];
  while (pending.length) {
    const cur = pending.pop()!;
    if (cur.kind === "element" || cur.kind === "document") {
      for (let i = cur.children.length - 1; i >= 0; i--) pending.push(cur.children[i]!);
    } else if (cur.kind === "text" || cur.kind === "cdata") {
      out += cur.value.text;
    }
  }
  return out;
}

function escapeXmlSync(val: string, attr: boolean): string {
  let out = "";
  for (const ch of val) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (attr && ch === "\"") out += "&quot;";
    else if (attr && ch === "\n") out += "&#10;";
    else if (ch === "\r") out += "&#13;";
    else if (attr && ch === "\t") out += "&#9;";
    else out += ch;
  }
  return out;
}

function serializeXmlNodeSync(node: SyncXmlNode): string {
  if (node.kind === "attribute") return ` ${node.value.name}="${escapeXmlSync(node.value.value, true)}"`;
  if (node.kind === "document") {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + node.children.map(serializeXmlNodeSync).join("\n") + "\n";
  }
  let out = "";
  const pending: (XmlContent | string)[] = [node.value];
  while (pending.length) {
    const cur = pending.pop()!;
    if (typeof cur === "string") { out += cur; continue; }
    if (cur.kind === "element") {
      out += `<${cur.name}`;
      for (const a of cur.attributes) out += ` ${a.name}="${escapeXmlSync(a.value, true)}"`;
      if (!cur.content.length) out += "/>";
      else {
        out += ">";
        pending.push(`</${cur.name}>`);
        for (let i = cur.content.length - 1; i >= 0; i--) pending.push(cur.content[i]!);
      }
    } else if (cur.kind === "text") out += escapeXmlSync(cur.text, false);
    else if (cur.kind === "cdata") out += `<![CDATA[${cur.text}]]>`;
    else if (cur.kind === "comment") out += `<!--${cur.text}-->`;
    else if (cur.kind === "processing-instruction") out += `<?${cur.target}${cur.text ? " " + cur.text : ""}?>`;
  }
  return out;
}

export function evalSyncXmllint(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if ((inBytes && inBytes.byteLength > 8192) || opArgs.length > 5) return undefined;
  let noout = false;
  let format = false;
  let c14n = false;
  let xpathQuery: string | undefined;
  let idx = 0;
  while (idx < opArgs.length) {
    const flag = opArgs[idx]!;
    if (flag === "--noout") { noout = true; idx++; }
    else if (flag === "--format") { format = true; idx++; }
    else if (flag === "--c14n") { c14n = true; idx++; }
    else if (flag === "--xpath" || flag.startsWith("--xpath=")) {
      if (xpathQuery !== undefined) return undefined;
      if (flag.startsWith("--xpath=")) {
        const q = flag.slice(8);
        if (!q) return undefined;
        xpathQuery = q;
        idx++;
      } else {
        idx++;
        if (opArgs[idx] === "--") idx++;
        const q = opArgs[idx];
        if (!q || q.startsWith("-")) return undefined;
        xpathQuery = q;
        idx++;
      }
    } else break;
  }
  if (opArgs[idx] === "--") idx++;
  const fileArg = opArgs[idx];
  if (idx + (fileArg !== undefined ? 1 : 0) < opArgs.length) return undefined;
  if (fileArg !== undefined && fileArg.startsWith("-") && fileArg !== "-") return undefined;
  if (xpathQuery !== undefined && (format || c14n || noout)) return undefined;

  let srcBytes = inBytes;
  if (fileArg !== undefined && fileArg !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(fileArg);
    if (!fBytes || fBytes.byteLength > 8192) return undefined;
    srcBytes = fBytes;
  } else if (!srcBytes) {
    return undefined;
  }
  if (srcBytes.includes(0)) return undefined;
  let xmlText: string;
  try {
    xmlText = syncXmlDecoder.decode(srcBytes);
  } catch {
    return undefined;
  }
  let root: XmlElement;
  try {
    const limits = resolveXmlQueryLimits(undefined);
    const parser = parseXmlSteps(xmlText, { ...limits, maxContentNodes: limits.maxNodes, expectedEncoding: "UTF-8" });
    let step = parser.next();
    while (!step.done) step = parser.next();
    root = step.value;
  } catch {
    return undefined;
  }
  if (noout && xpathQuery === undefined) return "";
  if (xpathQuery === undefined) {
    const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
    const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
    const renderElem = (el: XmlElement, depth: number): string => {
      const attrs = [...el.attributes].filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/");
      if (c14n) attrs.sort((a, b) => a.localName.localeCompare(b.localName));
      const attrStr = attrs.map(a => ` ${a.name}="${escAttr(a.value)}"`).join("");
      const children: XmlContent[] = [];
      let mixed = false;
      for (let i = 0; i < el.content.length; i++) {
        const ch = el.content[i]!;
        if (ch.kind === "text") {
          const blank = /^[ \t\n\r]*$/.test(ch.text);
          if (format && !c14n && !mixed && blank && (children.length > 0 || i + 1 < el.content.length)) continue;
          mixed = true;
        } else if (ch.kind === "cdata") mixed = true;
        children.push(ch);
      }
      if (children.length === 0) {
        return c14n ? `<${el.name}${attrStr}></${el.name}>` : `<${el.name}${attrStr}/>`;
      }
      const doIndent = format && !c14n && !mixed;
      let inner = "";
      for (const ch of children) {
        if (doIndent) inner += "\n" + "  ".repeat(depth + 1);
        if (ch.kind === "element") inner += renderElem(ch, depth + 1);
        else if (ch.kind === "text" || (ch.kind === "cdata" && c14n)) inner += escText(ch.text);
        else if (ch.kind === "cdata") inner += `<![CDATA[${ch.text}]]>`;
        else if (ch.kind === "comment") inner += `<!--${ch.text}-->`;
      }
      if (doIndent) inner += "\n" + "  ".repeat(depth);
      return `<${el.name}${attrStr}>${inner}</${el.name}>`;
    };
    if (c14n) return renderElem(root, 0);
    return `<?xml version="1.0"?>\n${renderElem(root, 0)}\n`;
  }

  // Support common XPath queries: string(...), count(...), boolean(...), and /a/b/c[@attr="v"]/text() or /a/b/@attr
  let q = xpathQuery.trim();
  let scalar: "string" | "count" | "boolean" | undefined;
  for (const s of ["string", "count", "boolean"] as const) {
    if (q.startsWith(s) && /^\s*\(/.test(q.slice(s.length)) && q.endsWith(")")) {
      scalar = s;
      q = q.slice(q.indexOf("(") + 1, -1).trim();
      break;
    }
  }
  const doc: SyncXmlNode = { kind: "document", children: [] };
  const order: SyncXmlNode[] = [doc];
  const parentOf = new Map<SyncXmlNode, SyncXmlNode>();
  const stack: { parent: SyncXmlNode & { children: SyncXmlNode[] }; content: XmlContent }[] = [{ parent: doc, content: root }];
  while (stack.length) {
    const { parent, content } = stack.pop()!;
    if (content.kind === "element") {
      const elNode: SyncXmlNode = { kind: "element", value: content, children: [], attributes: [] };
      parent.children.push(elNode);
      parentOf.set(elNode, parent);
      order.push(elNode);
      for (const attr of content.attributes) {
        if (attr.namespace === "http://www.w3.org/2000/xmlns/") continue;
        const aNode = { kind: "attribute" as const, value: attr };
        elNode.attributes.push(aNode);
        parentOf.set(aNode, elNode);
        order.push(aNode);
      }
      for (let i = content.content.length - 1; i >= 0; i--) {
        stack.push({ parent: elNode, content: content.content[i]! });
      }
    } else {
      const cNode: SyncXmlNode = { kind: content.kind, value: content };
      parent.children.push(cNode);
      parentOf.set(cNode, parent);
      order.push(cNode);
    }
  }

  // Split top-level union branches on "|" outside quotes and brackets
  const unionParts: string[] = [];
  {
    let cur = "";
    let inQ: string | undefined;
    let brDepth = 0;
    for (let i = 0; i < q.length; i++) {
      const ch = q[i]!;
      if (inQ) {
        if (ch === inQ) inQ = undefined;
        cur += ch;
      } else if (ch === "\"" || ch === "\x27") {
        inQ = ch;
        cur += ch;
      } else if (ch === "[") {
        brDepth++;
        cur += ch;
      } else if (ch === "]") {
        brDepth--;
        cur += ch;
      } else if (ch === "|" && brDepth === 0) {
        if (!cur.trim()) return undefined;
        unionParts.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (inQ || brDepth !== 0 || !cur.trim()) return undefined;
    unionParts.push(cur.trim());
  }

  const isNameChar = (c: string) => /^[A-Za-z0-9_.-]$/.test(c);
  const evalSingleBranch = (branch: string): SyncXmlNode[] | undefined => {
    let bContexts: SyncXmlNode[] = [doc];
    let at = 0;
    let firstStep = true;
    while (at < branch.length) {
      while (at < branch.length && /\s/.test(branch[at]!)) at++;
      if (!firstStep && branch[at] !== "/") return undefined;
      firstStep = false;
      let descendant = false;
      if (branch[at] === "/") {
        at++;
        if (branch[at] === "/") { descendant = true; at++; }
      }
      while (at < branch.length && /\s/.test(branch[at]!)) at++;
      let kind: "element" | "attribute" | "text" | "self" | "parent" = "element";
      if (branch[at] === "@") { kind = "attribute"; at++; }
      let selected = "";
      if (branch[at] === ".") {
        at++;
        if (branch[at] === ".") { kind = "parent"; at++; selected = "."; }
        else { kind = "self"; selected = "."; }
      } else if (branch[at] === "*") {
        selected = "*";
        at++;
      } else {
        const start = at;
        while (at < branch.length && isNameChar(branch[at]!)) at++;
        if (start === at || branch[at] === ":") return undefined;
        selected = branch.slice(start, at);
        while (at < branch.length && /\s/.test(branch[at]!)) at++;
        if (branch[at] === "(") {
          if (selected !== "text" || kind !== "element") return undefined;
          at++;
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          if (branch[at] !== ")") return undefined;
          at++;
          kind = "text";
        }
      }
      while (at < branch.length && /\s/.test(branch[at]!)) at++;
      const preds: (
        | { kind: "pos"; val: number }
        | { kind: "last" }
        | { kind: "attr"; name: string; val?: string; neq?: boolean }
        | { kind: "textEq"; val: string }
        | { kind: "child"; name: string; val?: string }
      )[] = [];
      while (branch[at] === "[") {
        at++;
        while (at < branch.length && /\s/.test(branch[at]!)) at++;
        if (/^[0-9]/.test(branch[at] ?? "")) {
          const s = at;
          while (at < branch.length && /^[0-9]$/.test(branch[at]!)) at++;
          const n = Number(branch.slice(s, at));
          if (!Number.isSafeInteger(n) || n < 1) return undefined;
          preds.push({ kind: "pos", val: n });
        } else if (branch.startsWith("position()", at)) {
          at += 10;
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          if (branch[at] !== "=") return undefined;
          at++;
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          const s = at;
          while (at < branch.length && /^[0-9]$/.test(branch[at]!)) at++;
          const n = Number(branch.slice(s, at));
          if (!Number.isSafeInteger(n) || n < 1) return undefined;
          preds.push({ kind: "pos", val: n });
        } else if (branch.startsWith("last()", at)) {
          at += 6;
          preds.push({ kind: "last" });
        } else if (branch.startsWith("text()", at)) {
          at += 6;
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          if (branch[at] !== "=") return undefined;
          at++;
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          const quote = branch[at++];
          if (quote !== "\"" && quote !== "\x27") return undefined;
          const vs = at;
          while (at < branch.length && branch[at] !== quote) at++;
          if (at >= branch.length) return undefined;
          preds.push({ kind: "textEq", val: branch.slice(vs, at++) });
        } else if (branch[at] === "@") {
          at++;
          const s = at;
          while (at < branch.length && isNameChar(branch[at]!)) at++;
          if (s === at) return undefined;
          const attrName = branch.slice(s, at);
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          if (branch[at] === "]") {
            preds.push({ kind: "attr", name: attrName });
          } else if (branch[at] === "=" || (branch[at] === "!" && branch[at + 1] === "=")) {
            const neq = branch[at] === "!";
            at += neq ? 2 : 1;
            while (at < branch.length && /\s/.test(branch[at]!)) at++;
            const quote = branch[at++];
            if (quote !== "\"" && quote !== "\x27") return undefined;
            const vs = at;
            while (at < branch.length && branch[at] !== quote) at++;
            if (at >= branch.length) return undefined;
            preds.push({ kind: "attr", name: attrName, val: branch.slice(vs, at++), neq });
          } else return undefined;
        } else if (isNameChar(branch[at] ?? "")) {
          const s = at;
          while (at < branch.length && isNameChar(branch[at]!)) at++;
          const childName = branch.slice(s, at);
          while (at < branch.length && /\s/.test(branch[at]!)) at++;
          if (branch[at] === "]") {
            preds.push({ kind: "child", name: childName });
          } else if (branch[at] === "=") {
            at++;
            while (at < branch.length && /\s/.test(branch[at]!)) at++;
            const quote = branch[at++];
            if (quote !== "\"" && quote !== "\x27") return undefined;
            const vs = at;
            while (at < branch.length && branch[at] !== quote) at++;
            if (at >= branch.length) return undefined;
            preds.push({ kind: "child", name: childName, val: branch.slice(vs, at++) });
          } else return undefined;
        } else {
          return undefined;
        }
        while (at < branch.length && /\s/.test(branch[at]!)) at++;
        if (branch[at] !== "]") return undefined;
        at++;
        while (at < branch.length && /\s/.test(branch[at]!)) at++;
      }

      if ((kind === "attribute" || kind === "text") && at < branch.length) return undefined;

      const parents = new Set<SyncXmlNode>();
      const pStack = [...bContexts];
      while (pStack.length) {
        const n = pStack.pop()!;
        if (parents.has(n)) continue;
        parents.add(n);
        if (descendant && (n.kind === "document" || n.kind === "element")) {
          for (const c of n.children) pStack.push(c);
        }
      }
      const selSet = new Set<SyncXmlNode>();
      for (const p of parents) {
        const cands =
          kind === "self" ? [p]
          : kind === "parent" ? (parentOf.has(p) ? [parentOf.get(p)!] : [])
          : kind === "attribute" ? (p.kind === "element" ? p.attributes : [])
          : (p.kind === "element" || p.kind === "document") ? p.children : [];
        let matched = cands.filter(c => {
          if (kind === "self" || kind === "parent") return true;
          if (kind === "text") return c.kind === "text" || c.kind === "cdata";
          if (c.kind !== kind) return false;
          if (c.kind === "element" || c.kind === "attribute") {
            return selected === "*" || (c.value.namespace === "" && c.value.localName === selected);
          }
          return false;
        });
        for (const pred of preds) {
          if (pred.kind === "pos") matched = matched[pred.val - 1] ? [matched[pred.val - 1]!] : [];
          else if (pred.kind === "last") matched = matched.length ? [matched[matched.length - 1]!] : [];
          else if (pred.kind === "textEq") {
            matched = matched.filter(c => c.kind === "element" && syncNodeStringValue(c) === pred.val);
          } else if (pred.kind === "child") {
            matched = matched.filter(c =>
              c.kind === "element" &&
              c.children.some(ch => ch.kind === "element" && ch.value.namespace === "" && ch.value.localName === pred.name && (pred.val === undefined || syncNodeStringValue(ch) === pred.val))
            );
          } else {
            matched = matched.filter(c =>
              c.kind === "element" &&
              c.attributes.some(a => a.value.namespace === "" && a.value.localName === pred.name && (pred.val === undefined || (pred.neq ? a.value.value !== pred.val : a.value.value === pred.val)))
            );
          }
        }
        for (const m of matched) selSet.add(m);
      }
      bContexts = order.filter(n => selSet.has(n));
    }
    return bContexts;
  };

  const unionSet = new Set<SyncXmlNode>();
  for (const part of unionParts) {
    const res = evalSingleBranch(part);
    if (!res) return undefined;
    for (const n of res) unionSet.add(n);
  }
  const contexts = order.filter(n => unionSet.has(n));

  if (scalar === "count") return String(contexts.length) + "\n";
  if (scalar === "boolean") return (contexts.length ? "true" : "false") + "\n";
  if (scalar === "string") return syncNodeStringValue(contexts[0]) + "\n";
  if (contexts.length === 0) return undefined;
  return contexts.map(serializeXmlNodeSync).join("\n") + "\n";
}

export function createXmlCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  const capturedOptions = { ...options };
  return [createXqCommand(capturedOptions), createXmllintCommand(capturedOptions)];
}

export function xmlCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXmlCommands(options);
  return {
    name: "xml-commands",
    setup(host) {
      if (!options.replace) {
        for (const command of commands) {
          if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
        }
      }
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncXmllint = evalSyncXmllint;
