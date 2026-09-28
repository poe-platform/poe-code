import { builtInDirectContextExecutors } from "safe-bash-command-io-engine/internal";
import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { readXmlInput, type XmlCommandRuntime } from "safe-bash-xml-engine/io";
import { parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import {
  FsError,
  getCommandArguments,
  writeBytes,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
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
import { evaluate, serialize, serializeSimpleSync, stringValue } from "safe-bash-xml-engine/evaluate";
import { serializeDocument, type DocumentMode } from "safe-bash-xml-engine/document";

const sharedEncoder = new TextEncoder();
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
  file: string | undefined;
}> {
  if (context.args.length > 5) throw new XmlQueryError("expected one XML input FILE or -", 2);
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
  while (index < args.length) {
    const flag = args[index]!;
    if (flag === "--noout") {
      noout = true;
      index++;
    } else if (flag === "--format") {
      mode ??= "format";
      format = true;
      index++;
    } else if (flag === "--c14n") {
      mode = "c14n";
      index++;
    } else if (flag === "--xpath") {
      if (xpathIndex !== undefined) throw new XmlQueryError("expected one --xpath QUERY", 2);
      index++;
      if (args[index] === "--") index++;
      const source = args[index];
      if (source === undefined || source.startsWith("-"))
        throw new XmlQueryError("expected QUERY [FILE|-]", 2);
      xpathIndex = index++;
    } else break;
  }
  if (args[index] === "--") index++;
  const fileIndex = index++;
  const file = args[fileIndex];
  if (
    index < args.length ||
    (file !== undefined && file.startsWith("-") && file !== "-" && args[fileIndex - 1] !== "--")
  ) {
    throw new XmlQueryError("expected one XML input FILE or -", 2);
  }
  if (xpathIndex !== undefined) {
    if (mode !== undefined || format) throw new XmlQueryError("expected --xpath QUERY [FILE|-]", 2);
    const query = await parseQuery(await admitted(xpathIndex, "maxSourceBytes"), budget);
    return {
      query,
      file: file === undefined ? undefined : await admitted(fileIndex, "maxInputBytes")
    };
  }
  mode ??= "format";
  return {
    mode,
    format,
    noout,
    file: file === undefined ? undefined : await admitted(fileIndex, "maxInputBytes")
  };
}

async function execute(
  context: CommandContext,
  limits: XmlQueryLimits,
  runtime: XmlCommandRuntime
): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal, runtime.yieldTurn);
  let outputFailed = false;
  try {
    const options = await argumentsFor(context, budget);
    const source = await readXmlInput(context, options.file, budget, runtime);
    const parser = parseXmlSteps(source, {
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
    const outBatch = new Uint8Array(16384);
    let outBatchUsed = 0;
    let writesCount = 0;
    async function flushWrite(): Promise<void> {
      if (outBatchUsed > 0) {
        const slice = outBatch.subarray(0, outBatchUsed);
        outBatchUsed = 0;
        writesCount++;
        try {
          await writeBytes(context.stdout, slice, context.signal);
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
        const bytes = sharedEncoder.encode(slice);
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
            await writeBytes(context.stdout, bytes, context.signal);
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
          parsed.value,
          options.mode,
          budget,
          options.format
        ))
          await write(part);
      }
      await flushWrite();
      return { exitCode: 0 };
    }
    const nodes = await evaluate(options.query, parsed.value, budget);
    if (options.query.scalar === "count") await write(String(nodes.length));
    else if (options.query.scalar === "boolean") await write(nodes.length ? "true" : "false");
    else if (options.query.scalar === "string") {
      for await (const part of stringValue(nodes[0], budget)) await write(part);
    } else {
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
      await flushWrite();
      return { exitCode: 0 };
    }
    await write("\n");
    await flushWrite();
    return { exitCode: 0 };
  } catch (error) {
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
  const limits = resolveXmlQueryLimits(options.limits);
  const definition: CommandDefinition = { name: "xmllint", execute: (context) => execute(context, limits, runtime) };
  if (options.limits === undefined) builtInDirectContextExecutors.add(definition.execute);
  return definition;
}

export function createXmllintCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  return [createXmllintCommand(options)];
}

export function xmllintCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const commands = createXmllintCommands(options);
  return {
    name: "xmllint-commands",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}

export type { XmlQueryLimits as XmllintLimits } from "safe-bash-xml-engine/limits";

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
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): string | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 5) return undefined;
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
    else if (flag === "--xpath") {
      if (xpathQuery !== undefined) return undefined;
      idx++;
      if (opArgs[idx] === "--") idx++;
      const q = opArgs[idx];
      if (!q || q.startsWith("-")) return undefined;
      xpathQuery = q;
      idx++;
    } else break;
  }
  if (opArgs[idx] === "--") idx++;
  const fileArg = opArgs[idx];
  if (idx + (fileArg !== undefined ? 1 : 0) < opArgs.length) return undefined;
  if (fileArg !== undefined && fileArg.startsWith("-") && fileArg !== "-") return undefined;
  if (xpathQuery !== undefined && (format || c14n || noout)) return undefined;
  if (xpathQuery === undefined && !noout) return undefined;

  let srcBytes = inBytes;
  if (fileArg !== undefined && fileArg !== "-") {
    if (!readFileSync) return undefined;
    const fBytes = readFileSync(fileArg);
    if (!fBytes || fBytes.byteLength > 8192) return undefined;
    srcBytes = fBytes;
  }
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
  if (!xpathQuery) return undefined;

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
  if (q.includes("|")) return undefined;

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

  let contexts: SyncXmlNode[] = [doc];
  let at = 0;
  let firstStep = true;
  const isNameChar = (c: string) => /^[A-Za-z0-9_.-]$/.test(c);
  while (at < q.length) {
    while (at < q.length && /\s/.test(q[at]!)) at++;
    if (!firstStep && q[at] !== "/") return undefined;
    firstStep = false;
    let descendant = false;
    if (q[at] === "/") {
      at++;
      if (q[at] === "/") { descendant = true; at++; }
    }
    while (at < q.length && /\s/.test(q[at]!)) at++;
    let kind: "element" | "attribute" | "text" | "self" | "parent" = "element";
    if (q[at] === "@") { kind = "attribute"; at++; }
    let selected = "";
    if (q[at] === ".") {
      at++;
      if (q[at] === ".") { kind = "parent"; at++; selected = "."; }
      else { kind = "self"; selected = "."; }
    } else if (q[at] === "*") {
      selected = "*";
      at++;
    } else {
      const start = at;
      while (at < q.length && isNameChar(q[at]!)) at++;
      if (start === at || q[at] === ":") return undefined;
      selected = q.slice(start, at);
      while (at < q.length && /\s/.test(q[at]!)) at++;
      if (q[at] === "(") {
        if (selected !== "text" || kind !== "element") return undefined;
        at++;
        while (at < q.length && /\s/.test(q[at]!)) at++;
        if (q[at] !== ")") return undefined;
        at++;
        kind = "text";
      }
    }
    while (at < q.length && /\s/.test(q[at]!)) at++;
    const preds: ({ kind: "pos"; val: number } | { kind: "last" } | { kind: "attr"; name: string; val?: string })[] = [];
    while (q[at] === "[") {
      at++;
      while (at < q.length && /\s/.test(q[at]!)) at++;
      if (/^[0-9]/.test(q[at] ?? "")) {
        const s = at;
        while (at < q.length && /^[0-9]$/.test(q[at]!)) at++;
        const n = Number(q.slice(s, at));
        if (!Number.isSafeInteger(n) || n < 1) return undefined;
        preds.push({ kind: "pos", val: n });
      } else if (q.startsWith("last()", at)) {
        at += 6;
        preds.push({ kind: "last" });
      } else if (q[at] === "@") {
        at++;
        const s = at;
        while (at < q.length && isNameChar(q[at]!)) at++;
        if (s === at) return undefined;
        const attrName = q.slice(s, at);
        while (at < q.length && /\s/.test(q[at]!)) at++;
        if (q[at] === "]") {
          preds.push({ kind: "attr", name: attrName });
        } else if (q[at] === "=") {
          at++;
          while (at < q.length && /\s/.test(q[at]!)) at++;
          const quote = q[at++];
          if (quote !== "\"" && quote !== "\x27") return undefined;
          const vs = at;
          while (at < q.length && q[at] !== quote) at++;
          if (at >= q.length) return undefined;
          preds.push({ kind: "attr", name: attrName, val: q.slice(vs, at++) });
        } else return undefined;
      } else {
        return undefined;
      }
      while (at < q.length && /\s/.test(q[at]!)) at++;
      if (q[at] !== "]") return undefined;
      at++;
      while (at < q.length && /\s/.test(q[at]!)) at++;
    }

    if ((kind === "attribute" || kind === "text") && at < q.length) return undefined;

    const parents = new Set<SyncXmlNode>();
    const pStack = [...contexts];
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
        else {
          matched = matched.filter(c =>
            c.kind === "element" &&
            c.attributes.some(a => a.value.namespace === "" && a.value.localName === pred.name && (pred.val === undefined || a.value.value === pred.val))
          );
        }
      }
      for (const m of matched) selSet.add(m);
    }
    contexts = order.filter(n => selSet.has(n));
  }

  if (scalar === "count") return String(contexts.length) + "\n";
  if (scalar === "boolean") return (contexts.length ? "true" : "false") + "\n";
  if (scalar === "string") return syncNodeStringValue(contexts[0]) + "\n";
  if (contexts.length === 0) return undefined;
  return contexts.map(serializeXmlNodeSync).join("\n") + "\n";
}

