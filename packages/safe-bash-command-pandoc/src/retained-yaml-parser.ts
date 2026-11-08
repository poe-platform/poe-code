/*!
 * YAML CST state machine adapted from yaml 2.9.0.
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
import {RetainedYamlLexer, type RetainedYamlToken} from "./retained-yaml-lexer.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import type {RetainedYamlCst, YamlCstNode, YamlCstType} from "./retained-yaml-cst.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";

type Step = AsyncGenerator<number, boolean | void>;
const isFlow = (node: YamlCstNode) => ["alias", "scalar", "single-quoted-scalar", "double-quoted-scalar", "flow-collection"].includes(node.type ?? "");

/** Existing YAML CST transitions over caller-backed records. Reprocessing and
 * ancestor retirement are iterative; even the construction stack stays backed.
 * Syntax errors throw separately from storage/cancellation failures. */
export class RetainedYamlParser {
  private atNewLine = true;
  private atScalar = false;
  private indent = 0;
  private offset: number;
  private onKeyLine = false;
  private stack = 0;
  private span: SourceRange;
  private type!: YamlCstType;
  private control: "\x02" | "\x18" | "\x1f" | undefined;
  constructor(private readonly source: RetainedSourceText, private readonly range: SourceRange,
    private readonly tree: RetainedYamlCst, private readonly cooperate: (units?: number) => Promise<void>) {
    this.offset = range.start; this.span = {start: range.start, end: range.start};
  }
  private async tokenType(token: RetainedYamlToken): Promise<YamlCstType> {
    if (typeof token === "string") return token === "\x02" ? "doc-mode" : token === "\x18" ? "flow-error-end" : "scalar";
    let small = "";
    if (token.end - token.start <= 3) for (let i = token.start; i < token.end; i++) small += await this.source.unit(i);
    const exact: Record<string, YamlCstType> = {"\uFEFF": "byte-order-mark", "---": "doc-start", "...": "doc-end", "": "newline", "\n": "newline", "\r\n": "newline", "-": "seq-item-ind", "?": "explicit-key-ind", ":": "map-value-ind", "{": "flow-map-start", "}": "flow-map-end", "[": "flow-seq-start", "]": "flow-seq-end", ",": "comma"};
    if (token.end - token.start <= 3 && Object.hasOwn(exact, small)) return exact[small]!;
    const first: Record<string, YamlCstType> = {" ": "space", "\t": "space", "#": "comment", "%": "directive-line", "*": "alias", "&": "anchor", "!": "tag", "'": "single-quoted-scalar", '"': "double-quoted-scalar", "|": "block-scalar-header", ">": "block-scalar-header"};
    const type = first[await this.source.unit(token.start)];
    if (!type) throw new RetainedYamlSyntaxError(token.start);
    return type;
  }
  async *parse(): AsyncGenerator<number> {
    this.stack = await this.tree.list();
    for await (const token of new RetainedYamlLexer(this.source, this.range, this.cooperate).lex()) {
      await this.cooperate();
      this.control = typeof token === "string" ? token : undefined;
      this.span = typeof token === "string" ? {start: this.offset, end: this.offset} : token;
      if (this.atScalar) {
        this.atScalar = false;
        while (yield* this.step()) await this.cooperate();
        this.offset = this.span.end; continue;
      }
      this.type = await this.tokenType(token);
      if (this.type === "scalar") {this.atNewLine = false; this.atScalar = true; continue;}
      while (yield* this.step()) await this.cooperate();
      switch (this.type) {
        case "newline": this.atNewLine = true; this.indent = 0; break;
        case "space": if (this.atNewLine && await this.source.unit(this.span.start) === " ") this.indent += this.span.end - this.span.start; break;
        case "explicit-key-ind": case "map-value-ind": case "seq-item-ind": if (this.atNewLine) this.indent += this.span.end - this.span.start; break;
        case "doc-mode": case "flow-error-end": continue;
        default: this.atNewLine = false;
      }
      this.offset = this.span.end;
    }
    while (await this.tree.count(this.stack)) yield* this.pop();
  }
  private async sourceToken(): Promise<number> {
    return this.tree.create({type: this.type, offset: this.offset, indent: this.indent, source: this.control ?? this.span});
  }
  private async includes(list: number, type: YamlCstType): Promise<boolean> {
    for await (const ref of this.tree.values(list)) if ((await this.tree.get(ref)).type === type) return true;
    return false;
  }
  private async nonEmpty(list: number): Promise<number> {
    let index = 0;
    for await (const ref of this.tree.values(list)) {
      if (!["space", "comment", "newline"].includes((await this.tree.get(ref)).type ?? "")) return index;
      index++;
    }
    return -1;
  }
  private async prevProps(parent: YamlCstNode): Promise<number> {
    if (parent.type === "document") return parent.start!;
    if (parent.type === "block-map" || parent.type === "block-seq") {
      const item = await this.tree.get((await this.tree.at(parent.items!, -1))!);
      return parent.type === "block-map" ? item.sep ?? item.start! : item.start!;
    }
    return this.tree.list();
  }
  private async firstKeyStart(prev: number): Promise<number> {
    let index = 0, start = 0;
    for await (const ref of this.tree.values(prev)) {
      const token = await this.tree.get(ref);
      if (["doc-start", "explicit-key-ind", "map-value-ind", "seq-item-ind", "newline"].includes(token.type ?? "")) start = index + 1;
      else if (start === index && token.type === "space") start++;
      index++;
    }
    return this.tree.split(prev, start);
  }

  private async fixFlowSeq(node: YamlCstNode): Promise<void> {
    if ((await this.tree.get(node.start!)).type !== "flow-seq-start") return;
    for await (const ref of this.tree.values(node.items!)) {
      const item = await this.tree.get(ref);
      if (item.sep && !item.value && !await this.includes(item.start!, "explicit-key-ind") && !await this.includes(item.sep, "map-value-ind")) {
        if (item.key && item.key !== -1) item.value = item.key;
        delete item.key;
        const value = item.value ? await this.tree.get(item.value) : undefined;
        if (value && isFlow(value)) {
          if (value.end) await this.tree.append(value.end, item.sep); else value.end = item.sep;
          await this.tree.put(item.value!, value);
        } else await this.tree.append(item.start!, item.sep);
        delete item.sep; await this.tree.put(ref, item);
      }
    }
  }
  private async *step(): Step {
    const ref = await this.tree.at(this.stack, -1), top = ref ? await this.tree.get(ref) : undefined;
    if (this.type === "doc-end" && top?.type !== "doc-end") {
      while (await this.tree.count(this.stack)) yield* this.pop();
      await this.tree.push(this.stack, await this.tree.create({type: "doc-end", offset: this.offset, source: this.span})); return;
    }
    if (!top) return yield* this.stream();
    switch (top.type) {
      case "document": return yield* this.document(ref!, top);
      case "alias": case "scalar": case "single-quoted-scalar": case "double-quoted-scalar": return yield* this.scalar(ref!, top);
      case "block-scalar": return yield* this.blockScalar(ref!, top);
      case "block-map": return yield* this.blockMap(top);
      case "block-seq": return yield* this.blockSequence(top);
      case "flow-collection": return yield* this.flowCollection(ref!, top);
      case "doc-end":
        if (this.type !== "doc-mode") {await this.endToken(ref!, top); if (this.type === "newline") yield* this.pop();} return;
      default: throw new RetainedYamlSyntaxError(this.offset);
    }
  }
  private async *pop(): AsyncGenerator<number> {
    const ref = await this.tree.pop(this.stack);
    if (!ref) throw new Error("Empty YAML construction stack");
    if (!await this.tree.count(this.stack)) {yield ref; return;}
    const node = await this.tree.get(ref), parentRef = (await this.tree.at(this.stack, -1))!, parent = await this.tree.get(parentRef);
    if (node.type === "block-scalar") {node.indent = parent.indent ?? 0; await this.tree.put(ref, node);}
    else if (node.type === "flow-collection" && parent.type === "document") {node.indent = 0; await this.tree.put(ref, node);}
    if (node.type === "flow-collection") await this.fixFlowSeq(node);
    switch (parent.type) {
      case "document": parent.value = ref; await this.tree.put(parentRef, parent); break;
      case "block-scalar": await this.tree.push(parent.props!, ref); break;
      case "block-map": {
        const itemRef = (await this.tree.at(parent.items!, -1))!, item = await this.tree.get(itemRef);
        if (item.value) {await this.tree.push(parent.items!, await this.tree.create({start: await this.tree.list(), key: ref, sep: await this.tree.list()})); this.onKeyLine = true; return;}
        if (item.sep) item.value = ref;
        else {item.key = ref; item.sep = await this.tree.list(); this.onKeyLine = !item.explicitKey; await this.tree.put(itemRef, item); return;}
        await this.tree.put(itemRef, item); break;
      }
      case "block-seq": {
        const itemRef = (await this.tree.at(parent.items!, -1))!, item = await this.tree.get(itemRef);
        if (item.value) await this.tree.push(parent.items!, await this.tree.create({start: await this.tree.list(), value: ref}));
        else {item.value = ref; await this.tree.put(itemRef, item);} break;
      }
      case "flow-collection": {
        const itemRef = await this.tree.at(parent.items!, -1), item = itemRef ? await this.tree.get(itemRef) : undefined;
        if (!item || item.value) await this.tree.push(parent.items!, await this.tree.create({start: await this.tree.list(), key: ref, sep: await this.tree.list()}));
        else {if (item.sep) item.value = ref; else {item.key = ref; item.sep = await this.tree.list();} await this.tree.put(itemRef!, item);} return;
      }
      default: throw new RetainedYamlSyntaxError(this.offset);
    }
    if (["document", "block-map", "block-seq"].includes(parent.type ?? "") && (node.type === "block-map" || node.type === "block-seq")) {
      const lastRef = await this.tree.at(node.items!, -1), last = lastRef ? await this.tree.get(lastRef) : undefined;
      if (last && !last.sep && !last.value && await this.tree.count(last.start!) && await this.nonEmpty(last.start!) === -1) {
        let move = true;
        if (node.indent !== 0) for await (const token of this.tree.values(last.start!)) {const st = await this.tree.get(token); if (st.type === "comment" && st.indent! >= node.indent!) {move = false; break;}}
        if (move) {
          if (parent.type === "document") {parent.end = last.start!; await this.tree.put(parentRef, parent);}
          else await this.tree.push(parent.items!, await this.tree.create({start: last.start!}));
          await this.tree.pop(node.items!);
        }
      }
    }
  }
  private async *stream(): Step {
    switch (this.type) {
      case "directive-line": yield await this.tree.create({type: "directive", offset: this.offset, source: this.span}); return;
      case "byte-order-mark": case "space": case "comment": case "newline": yield await this.sourceToken(); return;
      case "doc-mode": case "doc-start": {
        const start = await this.tree.list(); if (this.type === "doc-start") await this.tree.push(start, await this.sourceToken());
        await this.tree.push(this.stack, await this.tree.create({type: "document", offset: this.offset, start})); return;
      }
      default: throw new RetainedYamlSyntaxError(this.offset);
    }
  }
  private async *document(ref: number, node: YamlCstNode): Step {
    if (node.value) return yield* this.lineEnd(ref, node);
    if (this.type === "doc-start") {
      if (await this.nonEmpty(node.start!) !== -1) {yield* this.pop(); return true;}
      await this.tree.push(node.start!, await this.sourceToken()); return;
    }
    if (["anchor", "tag", "space", "comment", "newline"].includes(this.type)) {await this.tree.push(node.start!, await this.sourceToken()); return;}
    const value = await this.startBlockValue(node);
    if (!value) throw new RetainedYamlSyntaxError(this.offset);
    await this.tree.push(this.stack, value);
  }
  private async *scalar(ref: number, node: YamlCstNode): Step {
    if (this.type !== "map-value-ind") return yield* this.lineEnd(ref, node);
    const parent = await this.tree.get((await this.tree.at(this.stack, -2))!);
    const start = await this.firstKeyStart(await this.prevProps(parent)), sep = node.end ?? await this.tree.list();
    await this.tree.push(sep, await this.sourceToken()); delete node.end; await this.tree.put(ref, node);
    const item = await this.tree.create({start, key: ref, sep});
    const map = await this.tree.create({type: "block-map", offset: node.offset!, indent: node.indent!, items: await this.tree.list(item)});
    this.onKeyLine = true; await this.tree.set(this.stack, -1, map);
  }
  private async *blockScalar(ref: number, node: YamlCstNode): Step {
    if (["space", "comment", "newline"].includes(this.type)) {await this.tree.push(node.props!, await this.sourceToken()); return;}
    if (this.type === "scalar") {
      node.source = this.span; await this.tree.put(ref, node); this.atNewLine = true; this.indent = 0;
      yield* this.pop(); return;
    }
    yield* this.pop(); return true;
  }
  private async endToken(ref: number, node: YamlCstNode): Promise<void> {
    if (!node.end) {node.end = await this.tree.list(); await this.tree.put(ref, node);}
    await this.tree.push(node.end, await this.sourceToken());
  }
  private async *lineEnd(ref: number, node: YamlCstNode): Step {
    if (["comma", "doc-start", "doc-end", "flow-seq-end", "flow-map-end", "map-value-ind"].includes(this.type)) {yield* this.pop(); return true;}
    if (this.type === "newline") this.onKeyLine = false;
    await this.endToken(ref, node);
    if (this.type === "newline") yield* this.pop();
  }
  private async startBlockValue(parent: YamlCstNode): Promise<number | undefined> {
    const head = {offset: this.offset, indent: this.indent};
    switch (this.type) {
      case "alias": case "scalar": case "single-quoted-scalar": case "double-quoted-scalar": return this.sourceToken();
      case "block-scalar-header": return this.tree.create({type: "block-scalar", ...head, props: await this.tree.list(await this.sourceToken()), source: {start: this.offset, end: this.offset}});
      case "flow-map-start": case "flow-seq-start": return this.tree.create({type: "flow-collection", ...head, start: await this.sourceToken(), items: await this.tree.list(), end: await this.tree.list()});
      case "seq-item-ind": return this.tree.create({type: "block-seq", ...head, items: await this.tree.list(await this.tree.create({start: await this.tree.list(await this.sourceToken())}))});
      case "explicit-key-ind": case "map-value-ind": {
        this.onKeyLine = true;
        const start = await this.firstKeyStart(await this.prevProps(parent));
        let item: number;
        if (this.type === "explicit-key-ind") {await this.tree.push(start, await this.sourceToken()); item = await this.tree.create({start, explicitKey: true});}
        else item = await this.tree.create({start, key: -1, sep: await this.tree.list(await this.sourceToken())});
        return this.tree.create({type: "block-map", ...head, items: await this.tree.list(item)});
      }
    }
    return;
  }
  private async indentedComment(start: number, indent: number): Promise<boolean> {
    if (this.type !== "comment" || this.indent <= indent) return false;
    for await (const ref of this.tree.values(start)) if (!["newline", "space"].includes((await this.tree.get(ref)).type ?? "")) return false;
    return true;
  }
  private async *blockSequence(node: YamlCstNode): Step {
    const itemRef = (await this.tree.at(node.items!, -1))!, item = await this.tree.get(itemRef);
    switch (this.type) {
      case "newline":
        if (item.value) {
          const value = await this.tree.get(item.value), last = value.end ? await this.tree.at(value.end, -1) : undefined;
          if (last && (await this.tree.get(last)).type === "comment") await this.tree.push(value.end!, await this.sourceToken());
          else await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
        } else await this.tree.push(item.start!, await this.sourceToken());
        return;
      case "space": case "comment":
        if (item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
        else {
          if (await this.indentedComment(item.start!, node.indent!)) {
            const previous = await this.tree.at(node.items!, -2), prev = previous ? await this.tree.get(previous) : undefined;
            const value = prev?.value ? await this.tree.get(prev.value) : undefined;
            if (value?.end) {await this.tree.append(value.end, item.start!); await this.tree.push(value.end, await this.sourceToken()); await this.tree.pop(node.items!); return;}
          }
          await this.tree.push(item.start!, await this.sourceToken());
        }
        return;
      case "anchor": case "tag":
        if (item.value || this.indent <= node.indent!) break;
        await this.tree.push(item.start!, await this.sourceToken()); return;
      case "seq-item-ind":
        if (this.indent !== node.indent) break;
        if (item.value || await this.includes(item.start!, "seq-item-ind")) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
        else await this.tree.push(item.start!, await this.sourceToken()); return;
    }
    if (this.indent > node.indent!) {const value = await this.startBlockValue(node); if (value) {await this.tree.push(this.stack, value); return;}}
    yield* this.pop(); return true;
  }
  private async *flowCollection(ref: number, node: YamlCstNode): Step {
    const itemRef = await this.tree.at(node.items!, -1), item = itemRef ? await this.tree.get(itemRef) : undefined;
    if (this.type === "flow-error-end") {
      do {yield* this.pop(); const ref = await this.tree.at(this.stack, -1); if (!ref || (await this.tree.get(ref)).type !== "flow-collection") break;} while (true);
      return;
    }
    if (!await this.tree.count(node.end!)) {
      switch (this.type) {
        case "comma": case "explicit-key-ind":
          if (!item || item.sep) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
          else await this.tree.push(item.start!, await this.sourceToken()); return;
        case "map-value-ind":
          if (!item || item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(), key: -1, sep: await this.tree.list(await this.sourceToken())}));
          else if (item.sep) await this.tree.push(item.sep, await this.sourceToken());
          else {item.key = -1; item.sep = await this.tree.list(await this.sourceToken()); await this.tree.put(itemRef!, item);} return;
        case "space": case "comment": case "newline": case "anchor": case "tag":
          if (!item || item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
          else await this.tree.push(item.sep ?? item.start!, await this.sourceToken()); return;
        case "alias": case "scalar": case "single-quoted-scalar": case "double-quoted-scalar": {
          const value = await this.sourceToken();
          if (!item || item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(), key: value, sep: await this.tree.list()}));
          else if (item.sep) await this.tree.push(this.stack, value);
          else {item.key = value; item.sep = await this.tree.list(); await this.tree.put(itemRef!, item);} return;
        }
        case "flow-map-end": case "flow-seq-end": await this.tree.push(node.end!, await this.sourceToken()); return;
      }
      const value = await this.startBlockValue(node);
      if (value) {await this.tree.push(this.stack, value); return;}
      yield* this.pop(); return true;
    }
    const parent = await this.tree.get((await this.tree.at(this.stack, -2))!);
    if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === node.indent || this.type === "newline" && !(await this.tree.get((await this.tree.at(parent.items!, -1))!)).sep)) {yield* this.pop(); return true;}
    if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
      const start = await this.firstKeyStart(await this.prevProps(parent)); await this.fixFlowSeq(node);
      const sep = await this.tree.split(node.end!, 1); await this.tree.push(sep, await this.sourceToken());
      const item = await this.tree.create({start, key: ref, sep});
      const map = await this.tree.create({type: "block-map", offset: node.offset!, indent: node.indent!, items: await this.tree.list(item)});
      this.onKeyLine = true; await this.tree.set(this.stack, -1, map); return;
    }
    return yield* this.lineEnd(ref, node);
  }
  private async *blockMap(node: YamlCstNode): Step {
    const itemRef = (await this.tree.at(node.items!, -1))!, item = await this.tree.get(itemRef);
    switch (this.type) {
      case "newline":
        this.onKeyLine = false;
        if (item.value) {
          const value = await this.tree.get(item.value), last = value.end ? await this.tree.at(value.end, -1) : undefined;
          if (last && (await this.tree.get(last)).type === "comment") await this.tree.push(value.end!, await this.sourceToken());
          else await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
        } else await this.tree.push(item.sep ?? item.start!, await this.sourceToken());
        return;
      case "space": case "comment":
        if (item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(await this.sourceToken())}));
        else if (item.sep) await this.tree.push(item.sep, await this.sourceToken());
        else {
          if (await this.indentedComment(item.start!, node.indent!)) {
            const previous = await this.tree.at(node.items!, -2), prev = previous ? await this.tree.get(previous) : undefined;
            const value = prev?.value ? await this.tree.get(prev.value) : undefined;
            if (value?.end) {await this.tree.append(value.end, item.start!); await this.tree.push(value.end, await this.sourceToken()); await this.tree.pop(node.items!); return;}
          }
          await this.tree.push(item.start!, await this.sourceToken());
        }
        return;
    }
    if (this.indent >= node.indent!) {
      const atMapIndent = !this.onKeyLine && this.indent === node.indent;
      const atNextItem = atMapIndent && (item.sep || item.explicitKey) && this.type !== "seq-item-ind";
      let start = await this.tree.list();
      if (atNextItem && item.sep && !item.value) {
        // Only the second newline after the last reset is needed; the upstream
        // parser stores an input-sized newline-index vector for this decision.
        let count = 0, second = 0, index = 0;
        for await (const ref of this.tree.values(item.sep)) {
          const token = await this.tree.get(ref);
          switch (token.type) {
            case "newline": if (++count === 2) second = index; break;
            case "space": break;
            case "comment": if (token.indent! > node.indent!) count = 0; break;
            default: count = 0;
          }
          index++;
        }
        if (count >= 2) start = await this.tree.split(item.sep, second);
      }
      switch (this.type) {
        case "anchor": case "tag":
          if (atNextItem || item.value) {await this.tree.push(start, await this.sourceToken()); await this.tree.push(node.items!, await this.tree.create({start})); this.onKeyLine = true;}
          else await this.tree.push(item.sep ?? item.start!, await this.sourceToken()); return;
        case "explicit-key-ind":
          if (!item.sep && !item.explicitKey) {await this.tree.push(item.start!, await this.sourceToken()); item.explicitKey = true; await this.tree.put(itemRef, item);}
          else if (atNextItem || item.value) {await this.tree.push(start, await this.sourceToken()); await this.tree.push(node.items!, await this.tree.create({start, explicitKey: true}));}
          else {
            const child = await this.tree.create({start: await this.tree.list(await this.sourceToken()), explicitKey: true});
            await this.tree.push(this.stack, await this.tree.create({type: "block-map", offset: this.offset, indent: this.indent, items: await this.tree.list(child)}));
          }
          this.onKeyLine = true; return;
        case "map-value-ind":
          if (item.explicitKey) {
            if (!item.sep) {
              if (await this.includes(item.start!, "newline")) {item.key = -1; item.sep = await this.tree.list(await this.sourceToken()); await this.tree.put(itemRef, item);}
              else {
                const start = await this.firstKeyStart(item.start!);
                const child = await this.tree.create({start, key: -1, sep: await this.tree.list(await this.sourceToken())});
                await this.tree.push(this.stack, await this.tree.create({type: "block-map", offset: this.offset, indent: this.indent, items: await this.tree.list(child)}));
              }
            } else if (item.value) await this.tree.push(node.items!, await this.tree.create({start: await this.tree.list(), key: -1, sep: await this.tree.list(await this.sourceToken())}));
            else if (await this.includes(item.sep, "map-value-ind")) {
              const child = await this.tree.create({start, key: -1, sep: await this.tree.list(await this.sourceToken())});
              await this.tree.push(this.stack, await this.tree.create({type: "block-map", offset: this.offset, indent: this.indent, items: await this.tree.list(child)}));
            } else if (item.key && item.key !== -1 && isFlow(await this.tree.get(item.key)) && !await this.includes(item.sep, "newline")) {
              const start = await this.firstKeyStart(item.start!), key = item.key, sep = item.sep;
              await this.tree.push(sep, await this.sourceToken()); delete item.key; delete item.sep; await this.tree.put(itemRef, item);
              const child = await this.tree.create({start, key, sep});
              await this.tree.push(this.stack, await this.tree.create({type: "block-map", offset: this.offset, indent: this.indent, items: await this.tree.list(child)}));
            } else if (await this.tree.count(start)) {
              const sep = await this.tree.list(); await this.tree.append(sep, item.sep); await this.tree.append(sep, start); await this.tree.push(sep, await this.sourceToken());
              item.sep = sep; await this.tree.put(itemRef, item);
            } else await this.tree.push(item.sep, await this.sourceToken());
          } else {
            if (!item.sep) {item.key = -1; item.sep = await this.tree.list(await this.sourceToken()); await this.tree.put(itemRef, item);}
            else if (item.value || atNextItem) await this.tree.push(node.items!, await this.tree.create({start, key: -1, sep: await this.tree.list(await this.sourceToken())}));
            else if (await this.includes(item.sep, "map-value-ind")) {
              const child = await this.tree.create({start: await this.tree.list(), key: -1, sep: await this.tree.list(await this.sourceToken())});
              await this.tree.push(this.stack, await this.tree.create({type: "block-map", offset: this.offset, indent: this.indent, items: await this.tree.list(child)}));
            } else await this.tree.push(item.sep, await this.sourceToken());
          }
          this.onKeyLine = true; return;
        case "alias": case "scalar": case "single-quoted-scalar": case "double-quoted-scalar": {
          const value = await this.sourceToken();
          if (atNextItem || item.value) {await this.tree.push(node.items!, await this.tree.create({start, key: value, sep: await this.tree.list()})); this.onKeyLine = true;}
          else if (item.sep) await this.tree.push(this.stack, value);
          else {item.key = value; item.sep = await this.tree.list(); await this.tree.put(itemRef, item); this.onKeyLine = true;} return;
        }
        default: {
          const value = await this.startBlockValue(node);
          if (value) {
            if ((await this.tree.get(value)).type === "block-seq") {
              if (!item.explicitKey && item.sep && !await this.includes(item.sep, "newline")) throw new RetainedYamlSyntaxError(this.offset);
            } else if (atMapIndent) await this.tree.push(node.items!, await this.tree.create({start}));
            await this.tree.push(this.stack, value); return;
          }
        }
      }
    }
    yield* this.pop(); return true;
  }
}
