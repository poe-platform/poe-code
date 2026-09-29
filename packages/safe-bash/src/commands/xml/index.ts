import { parseXmlSteps, XmlLimitError } from "@poe-code/safe-fs/core";
import {
  getCommandArguments,
  toByteSource,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "../../contracts/index.js";
import { createXmllintCommand as createXmllintCommandInternal } from "safe-bash-command-xmllint";
import { readXmlInput } from "safe-bash-xml-engine/io";
import { yieldTurn } from "../../contracts/yield.js";
import { shellValueByteLength } from "../../contracts/value.js";
import { writeDiagnostic } from "../../escaping.js";
import { builtInDirectContextExecutors, pathOf } from "../internal.js";
import type { XmlAttribute, XmlContent, XmlElement } from "@poe-code/safe-fs/core";
import { interruptible } from "../structured/limits.js";
import {
  XmlBudget,
  XmlQueryError,
  XmlQueryLimitError,
  resolveXmlQueryLimits,
  type XmlCommandsOptions,
  type XmlQueryLimits
} from "./limits.js";
import { executeJq } from "../structured/jq.js";
import { Budget, JqError, resolveJqLimits } from "../structured/limits.js";
import { stringify } from "../structured/input.js";
import { xmlToJson } from "./json.js";

export { defaultXmlQueryLimits } from "./limits.js";
export type { XmlCommandsOptions, XmlQueryLimits } from "./limits.js";

const runtime = { yieldTurn, pathOf, interruptible, writeDiagnostic };

async function executeXq(
  context: CommandContext,
  limits: XmlQueryLimits
): Promise<{ exitCode: number }> {
  const budget = new XmlBudget(limits, context.signal, yieldTurn);
  try {
    const carrier = getCommandArguments(context);
    for (let index = 0; index < carrier.args.length; index++) {
      if (shellValueByteLength(carrier.values[index]!) > limits.maxInputBytes)
        throw new XmlQueryLimitError("maxInputBytes");
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          carrier.bytes(index)
        );
      } catch {
        throw new XmlQueryError("filters and filenames require valid UTF-8", 2);
      }
      if (decoded !== carrier.args[index])
        throw new XmlQueryError("filters and filenames require lossless UTF-8", 2);
      await budget.tick(decoded.length);
    }
    const jqLimits = resolveJqLimits({
      maxOutputBytes: limits.maxOutputBytes,
      maxSourceBytes: limits.maxSourceBytes,
      maxDepth: limits.maxDepth * 2 + 2,
      maxSteps: limits.maxSteps,
      maxResults: limits.maxResults
    });
    const conversionBudget = new Budget(jqLimits, context.signal);
    // Only XML conversion errors are translated; jq owns its sink failures.
    return executeJq(context, jqLimits, async (bytes) => {
      try {
        const source = await readXmlInput({ ...context, stdin: bytes }, undefined, budget, runtime);
        const parser = parseXmlSteps(source, {
          ...limits,
          maxContentNodes: limits.maxNodes,
          expectedEncoding: "UTF-8"
        });
        let parsed = parser.next();
        try {
          while (!parsed.done) {
            await budget.tick(parsed.value);
            parsed = parser.next();
          }
        } finally {
          if (!parsed.done) parser.return(undefined as never);
        }
        const value = await xmlToJson(parsed.value, budget);
        conversionBudget.value(value);
        return toByteSource(
          (await stringify(
            value,
            conversionBudget,
            false,
            jqLimits.maxValueBytes,
            "maxValueBytes"
          )) + "\n"
        );
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof XmlQueryError) throw new JqError(error.message, error.status);
        if (error instanceof XmlLimitError) throw new JqError(error.message, 5);
        if (error instanceof SyntaxError) throw new JqError(error.message, 1);
        throw error;
      }
    });
  } catch (error) {
    context.signal.throwIfAborted();
    if (!(error instanceof XmlQueryError)) throw error;
    await writeDiagnostic(
      context.stderr,
      `${context.command}: ${error.message.slice(0, 1000)}\n`,
      context.signal
    );
    return { exitCode: error.status };
  }
}

export function createXmllintCommand(options: XmlCommandsOptions = {}): CommandDefinition {
  const limits = resolveXmlQueryLimits(options.limits);
  const def = createXmllintCommandInternal({ limits }, runtime);
  if (options.limits === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}
export function createXmllintCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  return [createXmllintCommand(options)];
}
export function xmllintCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createXmllintCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "xmllint-commands",
    setup(host) {
      if (!replace)
        for (const definition of definitions) {
          if (host.commands.has(definition.name))
            throw new Error(`Command already registered: ${definition.name}`);
        }
      for (const definition of definitions) host.commands.register(definition, { replace });
    }
  };
}
export function createXmlCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] {
  const limits = resolveXmlQueryLimits(options.limits);
  const xqDef: CommandDefinition = { name: "xq", execute: (context) => executeXq(context, limits) };
  if (options.limits === undefined) builtInDirectContextExecutors.add(xqDef.execute);
  const xmllintDef = createXmllintCommand(options);
  return [xqDef, xmllintDef];
}
export function xmlCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createXmlCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "xml-commands",
    setup(host) {
      if (!replace)
        for (const definition of definitions) {
          if (host.commands.has(definition.name))
            throw new Error(`Command already registered: ${definition.name}`);
        }
      for (const definition of definitions) host.commands.register(definition, { replace });
    }
  };
}
export type XmllintCommandsOptions = XmlCommandsOptions;

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
  const isNameChar = (c: string) => /^[A-Za-z0-9_.-]$/.test(c);
  while (at < q.length) {
    while (at < q.length && /\s/.test(q[at]!)) at++;
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

function xmlElementToJsonSync(node: XmlElement): unknown {
  const result: Record<string, unknown> = Object.create(null);
  const names = new Set<string>();
  for (const attribute of node.attributes) {
    result["@" + attribute.name] = attribute.value;
  }
  const text: string[] = [];
  for (const child of node.content) {
    if (child.kind === "text" || child.kind === "cdata") text.push(child.text);
    else if (child.kind === "element") {
      const value = xmlElementToJsonSync(child);
      if (!names.has(child.name)) {
        result[child.name] = value;
        names.add(child.name);
      } else {
        const previous = result[child.name];
        if (Array.isArray(previous)) previous.push(value);
        else result[child.name] = [previous, value];
      }
    }
  }
  const value = text.join("").trim();
  if (Object.keys(result).length === 0) return value || null;
  if (value) result["#text"] = value;
  return result;
}

let lastXqXmlText: string | undefined;
let lastXqJsonStr: string | undefined;

export function evalSyncXq(
  inBytes: Uint8Array,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): { jsonStr: string; jqArgs: string[] } | undefined {
  if (inBytes.byteLength > 8192 || opArgs.length > 5) return undefined;
  let rawOut = false;
  let compactOut = false;
  let ended = false;
  const positional: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") {
      if (a === "-r" || a === "--raw-output") { rawOut = true; continue; }
      if (a === "-c" || a === "--compact-output") { compactOut = true; continue; }
      if (a === "-rc" || a === "-cr") { rawOut = true; compactOut = true; continue; }
      return undefined;
    }
    positional.push(a);
  }
  const filter = positional[0] ?? ".";
  const fileArg = positional[1];
  if (positional.length > 2) return undefined;
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
  let jsonStr: string;
  if (xmlText === lastXqXmlText && lastXqJsonStr !== undefined) {
    jsonStr = lastXqJsonStr;
  } else {
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
    const rootObj: Record<string, unknown> = Object.create(null);
    rootObj[root.name] = xmlElementToJsonSync(root);
    jsonStr = JSON.stringify(rootObj);
    lastXqXmlText = xmlText;
    lastXqJsonStr = jsonStr;
  }
  const jqArgs: string[] = [];
  if (rawOut && compactOut) jqArgs.push("-rc");
  else if (rawOut) jqArgs.push("-r");
  else if (compactOut) jqArgs.push("-c");
  jqArgs.push(filter);
  return { jsonStr, jqArgs };
}
