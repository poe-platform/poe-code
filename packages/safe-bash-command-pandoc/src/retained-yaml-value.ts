/*!
 * YAML value and alias semantics adapted from yaml 2.9.0.
 * Copyright Eemeli Aro <eemeli@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, type TextRange} from "./backed-text.js";
import {BackedTextSet} from "./backed-text-set.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import {RetainedYamlCst} from "./retained-yaml-cst.js";
import {RetainedYamlParser} from "./retained-yaml-parser.js";
import {resolveRetainedYamlProps, resolveRetainedYamlEnd, yamlCstSourceLength} from "./retained-yaml-props.js";
import {resolveRetainedYamlCollection, type RetainedYamlChild} from "./retained-yaml-collection.js";
import {decodeRetainedYamlScalar, decodeRetainedYamlBlock, resolveRetainedYamlScalar, RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {resolveRetainedYamlTag, type RetainedYamlTag} from "./retained-yaml-tag.js";

import {decodeRetainedYamlBinary, resolveRetainedYamlTimestamp} from "./retained-yaml-special.js";

const kinds = ["null", "string", "number", "boolean", "map", "seq", "alias", "binary", "date", "merge", "set", "omap", "undefined"] as const;
const tags: RetainedYamlTag[] = ["implicit", "str", "int", "float", "bool", "null", "map", "seq", "binary", "timestamp", "merge", "omap", "pairs", "set", "unknown"];
export interface RetainedYamlValue {
  kind: typeof kinds[number];
  text?: TextRange;
  value?: number;
  first?: number;
  last?: number;
  anchor?: number;
  target?: number;
  count?: number;
  aliasCount?: number;
  tag?: RetainedYamlTag;
  decorated?: boolean;
}
interface Entry {key?: number; value?: number; next: number; previous: number}

/** YAML nodes, mapping pairs, anchor tables and traversal stacks in caller
 * storage. A snapshot holds only fixed-size scalar fields and text spans. */
export class RetainedYamlValues {
  readonly text: BackedText;
  private readonly tree: RetainedYamlCst;
  private readonly names: BackedTextSet;
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.text = new BackedText(storage, cooperate); this.tree = new RetainedYamlCst(storage, cooperate); this.names = new BackedTextSet(storage, this.text);
  }
  private async read(ref: number, size: number): Promise<number[]> {
    const bytes = await this.storage.read(ref, size * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    await this.cooperate(); return Array.from({length: size}, (_, i) => view.getFloat64(i * 8, true));
  }
  private async write(ref: number, values: number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat64(i * 8, value, true)); await this.storage.write(ref, bytes); await this.cooperate();
  }
  async get(ref: number): Promise<RetainedYamlValue> {
    const [kind, first, last, units, value, head, tail, anchor, target, count, aliasCount, tag, decorated] = await this.read(ref, 13);
    return {kind: kinds[kind!]!, text: {first: first!, last: last!, units: units!}, value: value!, first: head!, last: tail!, anchor: anchor!, target: target!, count: count!, aliasCount: aliasCount!, tag: tags[tag!]!, decorated: !!decorated};
  }
  private async put(ref: number, node: RetainedYamlValue): Promise<void> {
    await this.write(ref, [kinds.indexOf(node.kind), node.text?.first ?? 0, node.text?.last ?? 0, node.text?.units ?? 0, node.value ?? 0,
      node.first ?? 0, node.last ?? 0, node.anchor ?? 0, node.target ?? 0, node.count ?? 1, node.aliasCount ?? 0, tags.indexOf(node.tag ?? "implicit"), Number(!!node.decorated)]);
  }
  private async create(node: RetainedYamlValue): Promise<number> {const ref = this.storage.allocate(104); await this.put(ref, node); return ref;}
  private async append(ref: number, key: number | undefined, value: number | undefined): Promise<void> {
    const node = await this.get(ref), entry = this.storage.allocate(32);
    await this.write(entry, [key ?? 0, value ?? 0, 0, node.last ?? 0]);
    if (node.last) await this.write(node.last + 16, [entry]); else node.first = entry;
    node.last = entry; await this.put(ref, node);
  }
  async *entries(node: RetainedYamlValue, reverse = false): AsyncGenerator<Entry> {
    let ref = (reverse ? node.last : node.first) ?? 0;
    while (ref) {
      const [key, value, next, previous] = await this.read(ref, 4);
      yield {key: key!, value: value!, next: next!, previous: previous!}; ref = (reverse ? previous : next)!;
    }
  }
  private async enqueueChildren(node: RetainedYamlValue, stack: number): Promise<void> {
    for await (const entry of this.entries(node, true)) {
      if (entry.value) await this.tree.push(stack, entry.value);
      if (entry.key) await this.tree.push(stack, entry.key);
    }
  }
  private async aliasWeight(ref: number, converted: IntegerTable): Promise<number> {
    const stack = await this.tree.list(ref); let maximum = 0;
    while (await this.tree.count(stack)) {
      const node = await this.get((await this.tree.pop(stack))!);
      if (node.kind === "alias") {
        if (await converted.get(BigInt(node.target!)) === undefined) continue;
        const target = await this.get(node.target!); maximum = Math.max(maximum, target.count! * target.aliasCount!);
      } else if (["map", "seq", "set", "omap"].includes(node.kind)) await this.enqueueChildren(node, stack);
      else maximum = Math.max(maximum, 1);
    }
    return maximum;
  }
  private async resolveAliases(root: number): Promise<void> {
    const anchors = new IntegerTable(this.storage, 64), stack = await this.tree.list(root);
    while (await this.tree.count(stack)) {
      const ref = (await this.tree.pop(stack))!, node = await this.get(ref);
      if (node.kind === "alias") {
        node.target = Number(await anchors.get(BigInt(node.anchor!)) ?? 0n);
        if (!node.target) throw new RetainedYamlSyntaxError(0);
        await this.put(ref, node);
      } else {
        if (node.anchor) await anchors.set(BigInt(node.anchor), BigInt(ref));
        await this.enqueueChildren(node, stack);
      }
    }
  }

  private async scalarIdentity(ref: number): Promise<string | TextRange> {
    const node = await this.get(ref);
    if (node.kind !== "string") return ["null", "undefined", "boolean", "number"].includes(node.kind) ? `${node.kind}:${node.value}` : `node:${ref}`;
    const text = this.text;
    return text.from((async function* () {yield "string:"; yield* text.chunks(node.text!);})());
  }
  private async normalizeCollections(root: number): Promise<void> {
    const pending = await this.tree.list(root), order = await this.tree.list();
    while (await this.tree.count(pending)) {
      const ref = (await this.tree.pop(pending))!; await this.tree.push(order, ref); await this.enqueueChildren(await this.get(ref), pending);
    }
    while (await this.tree.count(order)) {
      const ref = (await this.tree.pop(order))!, node = await this.get(ref);
      if (node.kind === "map" && node.tag === "set") {
        for await (const entry of this.entries(node)) if (entry.value) {
          const value = await this.get(entry.value);
          if (value.kind !== "null" || value.tag !== "implicit" || value.decorated) throw new RetainedYamlSyntaxError(0);
        }
        node.kind = "set"; await this.put(ref, node);
      } else if (node.kind === "seq" && (node.tag === "pairs" || node.tag === "omap")) {
        const original = {...node}; node.first = 0; node.last = 0;
        if (node.tag === "omap") node.kind = "omap";
        await this.put(ref, node);
        for await (const entry of this.entries(original)) {
          const child = await this.get(entry.value!); let key: number, value: number | undefined;
          if (child.kind === "map" || child.kind === "set") {
            if (child.first !== child.last) throw new RetainedYamlSyntaxError(0);
            const pair = (await this.entries(child).next()).value;
            key = pair?.key || await this.create({kind: "null"}); value = pair?.value;
          } else key = entry.value!;
          if (node.kind === "omap") await this.append(ref, key, value);
          else {
            const pair = await this.create({kind: "map"}); await this.append(pair, key, value); await this.append(ref, undefined, pair);
          }
        }
      }
    }
  }
  /** JavaScript property coercion used by merge insertion. Ordinary collection
   * keys use YAML presentation instead, supplied by the renderer callback. */
  private async *jsKeyChunks(ref: number): AsyncGenerator<string> {
    const pending = await this.tree.list(await this.tree.create({value: ref})), active = new IntegerTable(this.storage, 64);
      while (await this.tree.count(pending)) {
        const job = await this.tree.get((await this.tree.pop(pending))!);
        if (job.key === 1) {await active.set(BigInt(job.value!), 0n); continue;}
        if (job.key === 2) {yield ","; continue;}
        const value = await this.get(job.value!);
        switch (value.kind) {
          case "string": yield* this.text.chunks(value.text!); break;
          case "null": if (!job.indent) yield "null"; break;
          case "undefined": if (!job.indent) yield "undefined"; break;
          case "boolean": yield value.value ? "true" : "false"; break;
          case "number": yield String(value.value); break;
          case "merge": if (job.indent) throw new RetainedYamlSyntaxError(0); yield "Symbol(<<)"; break;
          case "date": yield new Date(value.value!).toString(); break;
          case "map": yield "[object Object]"; break;
          case "omap": yield "[object Map]"; break;
          case "set": yield "[object Set]"; break;
          case "binary": {
            let buffer = "", first = true;
            for await (const chunk of this.text.chunks(value.text!)) for (let index = 0; index < chunk.length; index++) {
              buffer += (first ? "" : ",") + chunk.charCodeAt(index); first = false;
              if (buffer.length >= 4096) {yield buffer; buffer = "";}
            }
            if (buffer) yield buffer; break;
          }
          case "seq": {
            if (await active.get(BigInt(job.value!))) break;
            await active.set(BigInt(job.value!), 1n);
            await this.tree.push(pending, await this.tree.create({key: 1, value: job.value!}));
            for await (const entry of this.entries(value, true)) {
              await this.tree.push(pending, await this.tree.create({value: entry.value!, indent: 1}));
              if (entry.previous) await this.tree.push(pending, await this.tree.create({key: 2}));
            }
            break;
          }
          default: throw new RetainedYamlSyntaxError(0);
        }
      }
  }

  /** Convert YAML nodes into a backed JS-value graph. Collections are copied on
   * each real visit; aliases share the last converted anchor result. Merge-source
   * aliases resolve without consuming the ordinary alias budget, matching YAML's
   * toJS path. The callback renders a collection key with YAML presentation. */
  async convert(root: number, renderKey: (ref: number) => Promise<TextRange>): Promise<number> {
    const converted = new IntegerTable(this.storage, 64), merging = new IntegerTable(this.storage, 64);
    const identities = new BackedTextSet(this.storage, this.text), properties = new IntegerTable(this.storage, 64);
    const nil = await this.create({kind: "null"}), missing = await this.create({kind: "undefined"});
    const result = this.storage.allocate(8); let top = 0;
    const push = async (op: number, a = 0, b = 0, c = 0, d = 0, e = 0) => {
      const ref = this.storage.allocate(56); await this.write(ref, [top, op, a, b, c, d, e]); top = ref;
    };
    const saved = async (slot: number) => (await this.read(slot, 1))[0]!;
    const insert = async (parent: number, key: number, value: number, onlyMissing = false, rejectDuplicate = false) => {
      const identity = await this.scalarIdentity(key), text = this.text;
      const name = await identities.intern(() => (async function* () {yield `${parent}:`; if (typeof identity === "string") yield identity; else yield* text.chunks(identity);})());
      const prior = Number(await properties.get(BigInt(name)) ?? 0n);
      if (prior) {
        if (rejectDuplicate) throw new RetainedYamlSyntaxError(0);
        if (!onlyMissing) await this.write(prior + 8, [value]);
      } else {
        await this.append(parent, key, value);
        await properties.set(BigInt(name), BigInt((await this.get(parent)).last!));
      }
    };
    const alias = async (ref: number, slot: number) => {
      const node = await this.get(ref), target = await this.get(node.target!);
      target.count!++; await this.put(node.target!, target);
      if (!target.aliasCount) target.aliasCount = await this.aliasWeight(node.target!, converted);
      if (target.count! * target.aliasCount > 32) throw new RetainedYamlSyntaxError(0);
      await this.put(node.target!, target);
      await this.write(slot, [Number(await converted.get(BigInt(node.target!))!)]);
    };
    await push(0, root, result);
    while (top) {
      const [previous, op, a, b, c, d, e] = await this.read(top, 7); top = previous!;
      switch (op) {
        case 0: { // Convert source a into slot b; c selects direct toJSON(Map).
          const node = await this.get(a!);
          if (node.kind === "alias") {
            if (await converted.get(BigInt(node.target!)) !== undefined) await alias(a!, b!);
            else {await push(6, a!, b!); await push(0, node.target!, b!);}
            break;
          }
          const collection = ["map", "seq", "set", "omap"].includes(node.kind);
          const output = collection ? await this.create({kind: c && node.kind === "map" ? "omap" : node.kind}) : a!;
          await this.write(b!, [output]);
          if (!c && node.anchor) {
            node.count = 1; node.aliasCount = 0; await this.put(a!, node); await converted.set(BigInt(a!), BigInt(output));
          }
          if (collection) await push(1, a!, output, node.first!);
          break;
        }
        case 1: { // Visit the next collection entry, in conversion order.
          if (!c) break;
          const parent = await this.get(a!), [keyRef, valueRef, next] = await this.read(c!, 4);
          await push(1, a!, b!, next!);
          if (parent.kind === "map" && keyRef && (await this.get(keyRef)).kind === "merge") {await push(3, valueRef || nil, b!); break;}
          const key = parent.kind === "seq" ? 0 : this.storage.allocate(8), value = parent.kind === "set" ? 0 : this.storage.allocate(8);
          await push(2, a!, b!, key, value, keyRef || nil);
          if (parent.kind !== "set") await push(0, valueRef || nil, value);
          if (parent.kind !== "seq") await push(0, keyRef || nil, key);
          break;
        }
        case 2: { // Install a converted key/value pair or sequence element.
          const source = await this.get(a!), output = await this.get(b!), keyRef = c ? await saved(c) : nil, value = d ? await saved(d) : nil;
          if (output.kind === "seq") {await this.append(b!, undefined, value); break;}
          let key = keyRef;
          if (output.kind === "map") {
            const node = await this.get(key), original = await this.get(e!);
            let rendered: TextRange;
            if (["map", "seq", "set", "omap", "date", "binary"].includes(node.kind) && original.kind === "alias") {
              const text = this.text;
              rendered = await text.from((async function* () {yield "*"; yield* text.chunks(original.text!);})());
            } else if (["map", "seq", "set", "omap"].includes(node.kind)) rendered = await renderKey(e!);
            else rendered = node.kind === "null" ? await this.text.from([""]) : await this.text.from(this.jsKeyChunks(key));
            key = await this.create({kind: "string", text: rendered});
          }
          await insert(b!, key, value, false, source.kind === "omap"); break;
        }
        case 3: { // Resolve merge sources without visiting their alias nodes.
          let ref = a!, node = await this.get(ref);
          if (node.kind === "alias") {ref = node.target!; node = await this.get(ref);}
          if (node.kind === "seq") {
            for await (const entry of this.entries(node, true)) await push(4, entry.value || nil, b!);
          } else if (node.kind === "omap") {
            if (node.first) throw new RetainedYamlSyntaxError(0);
          } else await push(4, ref, b!);
          break;
        }
        case 4: { // Merge a map's direct toJSON(Map) conversion.
          let ref = a!, node = await this.get(ref);
          if (node.kind === "alias") {ref = node.target!; node = await this.get(ref);}
          if (node.kind !== "map" && node.kind !== "set" || await merging.get(BigInt(ref))) throw new RetainedYamlSyntaxError(0);
          await merging.set(BigInt(ref), 1n);
          const slot = this.storage.allocate(8); await push(5, slot, b!, ref); await push(0, ref, slot, 1); break;
        }
        case 5: { // Copy missing own properties; earlier merge sources win.
          const source = await this.get(await saved(a!)), target = await this.get(b!);
          for await (const entry of this.entries(source)) {
            let key = entry.key!, value = entry.value || missing;
            if (source.kind === "set") {
              const item = await this.get(key); key = missing; value = missing;
              if (item.kind === "string") {
                let index = 0;
                outer: for await (const chunk of this.text.unicodeChunks(item.text!)) for (const char of chunk) {
                  const part = await this.create({kind: "string", text: await this.text.from([char])});
                  if (!index++) key = part; else {value = part; break outer;}
                }
              } else if (item.kind === "binary") {
                let index = 0;
                outer: for await (const chunk of this.text.chunks(item.text!)) for (let at = 0; at < chunk.length; at++) {
                  const part = await this.create({kind: "number", value: chunk.charCodeAt(at)});
                  if (!index++) key = part; else {value = part; break outer;}
                }
              } else if (["seq", "set", "omap"].includes(item.kind)) {
                let index = 0;
                for await (const part of this.entries(item)) {
                  let element = item.kind === "set" ? part.key! : part.value!;
                  if (item.kind === "omap") {
                    element = await this.create({kind: "seq"}); await this.append(element, undefined, part.key!); await this.append(element, undefined, part.value || nil);
                  }
                  if (!index++) key = element; else {value = element; break;}
                }
              } else throw new RetainedYamlSyntaxError(0);
            }
            if (target.kind === "map" && (await this.get(key)).kind !== "merge") key = await this.create({kind: "string", text: await this.text.from(this.jsKeyChunks(key))});
            await insert(b!, key, value, true);
          }
          await merging.set(BigInt(c!), 0n); break;
        }
        case 6: await alias(a!, b!); break;
      }
    }
    return saved(result);
  }

  async compose(source: RetainedSourceText, range: SourceRange): Promise<number> {
    const tree = this.tree, pending = await tree.list(), duplicateKeys = new BackedTextSet(this.storage, this.text);
    const make = async ({token: ref, props}: RetainedYamlChild): Promise<number> => {
      const token = ref !== undefined && ref >= 0 ? await tree.get(ref) : {type: "scalar" as const, offset: props.end, source: {start: props.end, end: props.end}};
      const offset = token.offset!, span = token.source && typeof token.source !== "string" ? token.source : {start: offset, end: offset};
      let anchor = 0, tag: RetainedYamlTag = "implicit";
      if (props.anchor) {
        const property = (await tree.get(props.anchor)).source as SourceRange;
        if (property.end - property.start <= 1) throw new RetainedYamlSyntaxError(property.start);
        anchor = await this.names.intern(() => source.chunks({start: property.start + 1, end: property.end}));
      }
      if (props.tag) tag = await resolveRetainedYamlTag(source, (await tree.get(props.tag)).source as SourceRange, this.cooperate);
      if (token.type === "alias") {
        if (anchor || props.tag || span.end - span.start <= 1) throw new RetainedYamlSyntaxError(offset);
        await resolveRetainedYamlEnd(tree, token.end, span.end, true);
        const identity = await this.names.intern(() => source.chunks({start: span.start + 1, end: span.end}));
        return this.create({kind: "alias", anchor: identity, text: await this.text.from(source.chunks({start: span.start + 1, end: span.end}))});
      }
      if (token.type === "block-map" || token.type === "block-seq" || token.type === "flow-collection") {
        if (token.type === "block-seq" && (props.anchor || props.tag)) {
          const latest = Math.max(props.anchor ? (await tree.get(props.anchor)).offset! : -1, props.tag ? (await tree.get(props.tag)).offset! : -1);
          if (!props.newlineAfterProp || (await tree.get(props.newlineAfterProp)).offset! < latest) throw new RetainedYamlSyntaxError(latest);
        }
        const map = token.type === "block-map" || token.type === "flow-collection" && (await tree.get(token.start!)).type === "flow-map-start";
        const output = await this.create({kind: map ? "map" : "seq", anchor, tag});
        await tree.push(pending, await tree.create({key: output, value: ref!})); return output;
      }
      let text: TextRange;
      if (token.type === "block-scalar") {
        const header = await tree.at(token.props!, 0), start = (await tree.get(header!)).offset!;
        text = await decodeRetainedYamlBlock(source, {start, end: span.end}, token.indent!, this.text, this.cooperate);
      } else {
        text = await decodeRetainedYamlScalar(source, span, this.text, this.cooperate);
        await resolveRetainedYamlEnd(tree, token.end, offset + yamlCstSourceLength(token), true);
      }
      if (tag === "binary") return this.create({kind: "binary", text: await decodeRetainedYamlBinary(this.text, text), anchor, tag});
      if (tag === "timestamp") return this.create({kind: "date", value: await resolveRetainedYamlTimestamp(this.text, text), text, anchor, tag});
      if (tag === "merge") return this.create({kind: "merge", text, anchor, tag});
      let decorated = props.comment;
      for (const list of [token.end, token.props]) if (list) for await (const ref of tree.values(list)) if ((await tree.get(ref)).type === "comment") decorated = true;
      const expected = tag === "int" || tag === "float" || tag === "bool" || tag === "null" ? tag : undefined;
      const value = expected || tag === "implicit" && token.type === "scalar" ? await resolveRetainedYamlScalar(this.text, text, this.cooperate, expected) : {kind: "string" as const, text};
      return this.create({kind: value.kind, text, ...(value.kind === "string" ? {} : {value: value.value === null ? 0 : Number(value.value)}), anchor, tag, decorated});
    };
    let root: number | undefined;
    for await (const ref of new RetainedYamlParser(source, range, tree, this.cooperate).parse()) {
      const doc = await tree.get(ref);
      if (doc.type === "document") {
        if (root !== undefined) throw new RetainedYamlSyntaxError(doc.offset!);
        const props = await resolveRetainedYamlProps(source, tree, doc.start, {indicator: "doc-start", next: doc.value, offset: doc.offset!, parentIndent: 0, startOnNewline: true});
        root = await make({token: doc.value, props});
      } else if (doc.type === "directive" || doc.type === "directive-line") throw new RetainedYamlSyntaxError(doc.offset!);
    }
    root ??= await this.create({kind: "null"});
    while (await tree.count(pending)) {
      const job = await tree.get((await tree.pop(pending))!), parent = await this.get(job.key!);
      for await (const entry of resolveRetainedYamlCollection(source, tree, job.value!)) {
        const key = entry.key ? await make(entry.key) : undefined, value = entry.value ? await make(entry.value) : undefined;
        if (parent.kind === "map" && key) {
          const node = await this.get(key);
          if (["string", "number", "boolean", "null"].includes(node.kind) && !(node.kind === "number" && Number.isNaN(node.value))) {
            const text = this.text;
            const identity = await text.from((async function* () {
              yield `${job.key!}:${node.kind}:`;
              if (node.kind === "string") yield* text.chunks(node.text!); else yield String(node.value);
            })());
            if (await duplicateKeys.has(identity)) throw new RetainedYamlSyntaxError(entry.key!.props.start);
            await duplicateKeys.add(identity);
          }
        }
        if (parent.kind === "seq" && key) {
          const pair = await this.create({kind: "map"}); await this.append(pair, key, value); await this.append(job.key!, undefined, pair);
        } else await this.append(job.key!, key, value);
      }
    }
    await this.normalizeCollections(root);
    await this.resolveAliases(root); return root;
  }
}
