import { formatPdfNumber, type PdfContentNode, type PdfCosNode, type PdfPathSegment, type PdfTextCommand } from "../ast.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfContentEvent } from "./parser.js";
import { readStoredItems, StoredMetadataStack } from "./stored-record.js";
import { readStoredPath } from "./stored-path.js";
import { serializeCosNodeChunks, serializeCosNodeBytes } from "../cos/writer.js";
import { bytesToString, stringToBytes } from "../bytes.js";

function fmtNum(n: number): string {
  return formatPdfNumber(Number(n.toFixed(6)));
}

function fmtNode(node: PdfCosNode): string {
  return bytesToString(serializeCosNodeBytes(node));
}

function serializeTextCommand(cmd: PdfTextCommand): string {
  switch (cmd.kind) {
    case "font":
      return `/${cmd.fontName} ${fmtNum(cmd.size)} Tf`;
    case "matrix":
      return `${cmd.matrix.map(fmtNum).join(" ")} Tm`;
    case "move":
      return `${fmtNum(cmd.tx)} ${fmtNum(cmd.ty)} ${cmd.setLeading ? "TD" : "Td"}`;
    case "next-line":
      return "T*";
    case "leading":
      return `${fmtNum(cmd.leading)} TL`;
    case "char-spacing":
      return `${fmtNum(cmd.charSpace)} Tc`;
    case "word-spacing":
      return `${fmtNum(cmd.wordSpace)} Tw`;
    case "horiz-scaling":
      return `${fmtNum(cmd.scalePercent)} Tz`;
    case "render-mode":
      return `${fmtNum(cmd.mode)} Tr`;
    case "rise":
      return `${fmtNum(cmd.rise)} Ts`;
    case "show-text":
      return `${fmtNode(cmd.token)} Tj`;
    case "show-text-array":
      return `[${cmd.items.map(fmtNode).join(" ")}] TJ`;
    case "state-op":
      return cmd.operands.length === 0 ? cmd.operator : `${cmd.operands.map(fmtNode).join(" ")} ${cmd.operator}`;
  }
}

function serializePathSegment(seg: PdfPathSegment): string {
  switch (seg.kind) {
    case "move":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} m`;
    case "line":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} l`;
    case "cubic":
      return `${fmtNum(seg.x1)} ${fmtNum(seg.y1)} ${fmtNum(seg.x2)} ${fmtNum(seg.y2)} ${fmtNum(seg.x)} ${fmtNum(seg.y)} c`;
    case "rect":
      return `${fmtNum(seg.x)} ${fmtNum(seg.y)} ${fmtNum(seg.width)} ${fmtNum(seg.height)} re`;
    case "close":
      return "h";
  }
}

export function serializeContentNodesToLines(
  nodes: readonly PdfContentNode[],
  inBt: { open: boolean } = { open: false },
  isRoot = true
): string[] {
  const lines: string[] = [];
  const closeBtIfOpen = () => {
    if (inBt.open) {
      lines.push("ET");
      inBt.open = false;
    }
  };
  for (const node of nodes) {
    switch (node.kind) {
      case "graphics-group":
        closeBtIfOpen();
        lines.push("q");
        lines.push(...serializeContentNodesToLines(node.ops, { open: false }, true));
        lines.push("Q");
        break;
      case "marked-content":
        if (node.properties !== undefined) {
          const propStr =
            typeof node.properties === "string"
              ? `/${node.properties}`
              : fmtNode(node.properties);
          lines.push(`/${node.tag} ${propStr} BDC`);
        } else {
          lines.push(`/${node.tag} BMC`);
        }
        lines.push(...serializeContentNodesToLines(node.children, inBt, false));
        lines.push("EMC");
        break;
      case "text-object":
        if (!node.continuation) {
          closeBtIfOpen();
          lines.push("BT");
          inBt.open = true;
        } else if (!inBt.open) {
          lines.push("BT");
          inBt.open = true;
        }
        for (const cmd of node.commands) {
          lines.push(serializeTextCommand(cmd));
        }
        if (node.end) closeBtIfOpen();
        break;
      case "path-op":
        closeBtIfOpen();
        for (const seg of node.segments) {
          lines.push(serializePathSegment(seg));
        }
        if (node.clip) {
          lines.push(node.clip);
        }
        lines.push(node.paint);
        break;
      case "xobject":
        closeBtIfOpen();
        lines.push(`/${node.name} Do`);
        break;
      case "inline-image": {
        closeBtIfOpen();
        const entryParts: string[] = [];
        for (const entry of node.dict.entries) {
          entryParts.push(`/${entry.key.decoded} ${fmtNode(entry.value)}`);
        }
        lines.push(`BI ${entryParts.join(" ")} ID`);
        lines.push(bytesToString(node.data));
        lines.push("EI");
        break;
      }
      case "state-op": {
        closeBtIfOpen();
        if (node.operands.length === 0) {
          lines.push(node.operator);
        } else {
          lines.push(`${node.operands.map(fmtNode).join(" ")} ${node.operator}`);
        }
        break;
      }
    }
  }
  if (isRoot) {
    closeBtIfOpen();
  }
  return lines;
}

export function serializeContentAst(nodes: readonly PdfContentNode[]): Uint8Array {
  return stringToBytes(serializeContentNodesToLines(nodes).join("\n"));
}

/** Serialize flattened parser events with caller-backed group state. Borrowed
 * paths, strings and image ranges are consumed before advancing their owner. */
export async function* serializeContentEventChunks(events: AsyncIterable<PdfContentEvent> | Iterable<PdfContentEvent>, storage: PdfIndexStorage,
  options: { chunkBytes?: number; maxOutputBytes?: number; signal?: AbortSignal } = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 16384, maximum = options.maxOutputBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("Invalid content chunk size");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid content output limit");
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const groups = new StoredMetadataStack<"graphics-group" | "marked-content">(backing, signal);
  let openText = false, firstLine = true, failed = false;
  function* line() { if (!firstLine) yield "\n"; firstLine = false; }
  function* closeText() { if (openText) { yield* line(); yield "ET"; openText = false; } }
  async function* cos(node: PdfCosNode): AsyncGenerator<string | Uint8Array> {
    signal.throwIfAborted();
    if (node.kind === "string" && node.storedBytes) {
      const source = node.storedBytes; yield node.format === "hex" ? "<" : "(";
      for (let at = 0; at < source.byteLength; at += 4096) {
        signal.throwIfAborted(); const length = Math.min(4096, source.byteLength - at);
        const bytes = await source.storage.read(source.position + at, length, { signal });
        if (bytes.length !== length) throw new Error("Incomplete stored PDF string");
        const { storedBytes: ignored, ...plain } = node;
        const encoded = serializeCosNodeBytes({ ...plain, bytes });
        yield encoded.subarray(1, encoded.length - 1);
      }
      yield node.format === "hex" ? ">" : ")";
    } else if (node.kind === "array") {
      yield "[ "; for await (const item of node.storedItems ? readStoredItems<PdfCosNode>(node.storedItems, signal) : node.items) { yield* cos(item); yield " "; } yield "]";
    } else if (node.kind === "dict") {
      yield "<<\n"; for (const entry of node.entries) { yield* cos(entry.key); yield " "; yield* cos(entry.value); yield "\n"; } yield ">>";
    } else yield* serializeCosNodeChunks(node, { chunkBytes, signal });
  }
  async function* command(command: PdfTextCommand): AsyncGenerator<string | Uint8Array> {
    if (command.kind === "show-text") { yield* cos(command.token); yield " Tj"; }
    else if (command.kind === "show-text-array") {
      yield "["; let first = true;
      for await (const item of command.storedItems ? readStoredItems<PdfCosNode>(command.storedItems, signal) : command.items) { if (item.kind !== "string" && item.kind !== "number") continue; if (!first) yield " "; first = false; yield* cos(item); }
      yield "] TJ";
    } else if (command.kind === "state-op") {
      for (const operand of command.operands) { yield* cos(operand); yield " "; } yield command.operator;
    } else yield serializeTextCommand(command);
  }
  async function* endGroup(): AsyncGenerator<string | Uint8Array> {
    const group = await groups.pop(); if (!group) return;
    if (group === "graphics-group") yield* closeText();
    yield* line(); yield group === "graphics-group" ? "Q" : "EMC";
  }
  async function* eventParts(event: PdfContentEvent): AsyncGenerator<string | Uint8Array> {
    switch (event.kind) {
      case "begin-group": {
        const group = event.group;
        if (group.kind === "graphics-group") { yield* closeText(); yield* line(); yield "q"; }
        else {
          yield* line(); yield `/${group.tag}`;
          if (group.properties !== undefined) { yield " "; if (typeof group.properties === "string") yield `/${group.properties}`; else yield* cos(group.properties); yield " BDC"; }
          else yield " BMC";
        }
        await groups.push(group.kind); break;
      }
      case "end-group": yield* endGroup(); break;
      case "graphics-group": case "marked-content": {
        yield* eventParts({ kind: "begin-group", group: event });
        for (const child of event.kind === "graphics-group" ? event.ops : event.children) yield* eventParts(child);
        yield* endGroup(); break;
      }
      case "text-object":
        if (!event.continuation) { yield* closeText(); yield* line(); yield "BT"; openText = true; }
        else if (!openText) { yield* line(); yield "BT"; openText = true; }
        for (const item of event.commands) { yield* line(); yield* command(item); }
        if (event.end) yield* closeText();
        break;
      case "path-op":
        yield* closeText();
        for await (const segment of event.storedSegments ? readStoredPath(event.storedSegments, signal) : event.segments) { yield* line(); yield serializePathSegment(segment); }
        if (event.clip) { yield* line(); yield event.clip; }
        yield* line(); yield event.paint; break;
      case "inline-image":
        yield* closeText(); yield* line(); yield "BI ";
        for (let i = 0; i < event.dict.entries.length; i++) {
          if (i) yield " "; const entry = event.dict.entries[i]!; yield `/${entry.key.decoded} `; yield* cos(entry.value);
        }
        yield " ID"; yield* line();
        if (event.data instanceof Uint8Array) yield event.data;
        else yield* event.data.source.stream(event.data.start, event.data.end - event.data.start, signal);
        yield* line(); yield "EI"; break;
      case "xobject": yield* closeText(); yield* line(); yield `/${event.name} Do`; break;
      case "state-op":
        yield* closeText(); yield* line(); yield* command(event); break;
    }
  }
  async function* parts(): AsyncGenerator<string | Uint8Array> {
    for await (const event of events) { signal.throwIfAborted(); yield* eventParts(event); }
    while (groups.length) yield* endGroup();
    yield* closeText();
  }
  try {
    let buffer = new Uint8Array(chunkBytes), used = 0, total = 0, work = 0;
    for await (const part of parts()) {
      signal.throwIfAborted(); if (part.length > maximum - total) throw new Error("PDF content output limit exceeded"); total += part.length;
      for (let at = 0; at < part.length;) {
        const take = Math.min(chunkBytes - used, part.length - at);
        if (typeof part === "string") for (let i = 0; i < take; i++) buffer[used + i] = part.charCodeAt(at + i) & 255;
        else buffer.set(part.subarray(at, at + take), used);
        used += take; at += take;
        if (used === chunkBytes) { yield buffer; buffer = new Uint8Array(chunkBytes); used = 0; }
      }
      if (++work % 512 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
    }
    if (used) yield buffer.subarray(0, used);
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) throw error; }); }
}
