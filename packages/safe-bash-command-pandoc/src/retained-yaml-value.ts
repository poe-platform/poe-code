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

const kinds = ["null", "string", "number", "boolean", "map", "seq", "alias", "binary", "date", "merge", "set", "omap"] as const;
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
  private async aliasWeight(ref: number): Promise<number> {
    const stack = await this.tree.list(ref); let maximum = 0;
    while (await this.tree.count(stack)) {
      const node = await this.get((await this.tree.pop(stack))!);
      if (node.kind === "alias") {
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
    await this.validateOrderedMaps(root);
    // Conversion visits aliases once; their targets are shared, not expanded.
    await this.tree.push(stack, root);
    while (await this.tree.count(stack)) {
      const node = await this.get((await this.tree.pop(stack))!);
      if (node.kind === "alias") {
        const target = await this.get(node.target!); target.count!++;
        await this.put(node.target!, target);
        if (!target.aliasCount) target.aliasCount = await this.aliasWeight(node.target!);
        if (target.count! * target.aliasCount > 32) throw new RetainedYamlSyntaxError(0);
        await this.put(node.target!, target);
      } else await this.enqueueChildren(node, stack);
    }
  }
  private async scalarIdentity(ref: number): Promise<string | TextRange> {
    const node = await this.get(ref);
    if (node.kind !== "string") return ["null", "boolean", "number"].includes(node.kind) ? `${node.kind}:${node.value}` : `node:${ref}`;
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
  private async validateOrderedMaps(root: number): Promise<void> {
    const pending = await this.tree.list(root);
    while (await this.tree.count(pending)) {
      const node = await this.get((await this.tree.pop(pending))!);
      if (node.kind === "omap") {
        const keys = new BackedTextSet(this.storage, this.text);
        for await (const pair of this.entries(node)) {
          const key = await this.get(pair.key!);
          const identity = await this.scalarIdentity(key.kind === "alias" ? key.target! : pair.key!);
          if (await keys.has(identity)) throw new RetainedYamlSyntaxError(0);
          await keys.add(identity);
        }
      }
      await this.enqueueChildren(node, pending);
    }
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
        return this.create({kind: "alias", anchor: identity});
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
