/*!
 * YAML collection validation adapted from yaml 2.9.0.
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
import type {RetainedSourceText} from "./retained-source-text.js";
import type {RetainedYamlCst, YamlCstNode} from "./retained-yaml-cst.js";
import {resolveRetainedYamlEnd, resolveRetainedYamlProps, yamlCstSourceLength, type RetainedYamlProps} from "./retained-yaml-props.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";

export interface RetainedYamlChild {token?: number | undefined; props: RetainedYamlProps}
export interface RetainedYamlEntry {
  key?: RetainedYamlChild;
  value?: RetainedYamlChild;
  keyComment?: number;
  comment?: {target: "collection" | "previous"; tokens: number; replace?: boolean};
}
const present = (ref: number | undefined): ref is number => ref !== undefined && ref >= 0;
const block = (node: YamlCstNode | undefined) => node?.type === "block-map" || node?.type === "block-seq";

/** Find the rightmost CST boundary iteratively; no ancestry stays resident. */
export async function retainedYamlTokenEnd(tree: RetainedYamlCst, ref: number | undefined, fallback: number): Promise<number> {
  let end = fallback;
  while (present(ref)) {
    const node = await tree.get(ref);
    end = Math.max(end, (node.offset ?? end) + yamlCstSourceLength(node));
    if (node.end) {
      const last = await tree.at(node.end, -1);
      if (last !== undefined) {const token = await tree.get(last); end = Math.max(end, token.offset! + yamlCstSourceLength(token));}
    }
    if (node.type === "flow-collection") break;
    if (node.items) {
      const last = await tree.at(node.items, -1);
      if (last === undefined) break;
      const item = await tree.get(last);
      for (const list of [item.start, item.sep]) if (list) {
        const last = await tree.at(list, -1);
        if (last !== undefined) {const token = await tree.get(last); end = Math.max(end, token.offset! + yamlCstSourceLength(token));}
      }
      ref = present(item.value) ? item.value : item.key;
    } else break;
  }
  return end;
}

/** Match YAML's implicit-key newline check with an explicit backed work stack. */
async function containsNewline(source: RetainedSourceText, tree: RetainedYamlCst, ref: number | undefined): Promise<boolean> {
  if (!present(ref)) return false;
  const pending = await tree.list(ref);
  while (await tree.count(pending)) {
    const node = await tree.get((await tree.pop(pending))!);
    if (["alias", "scalar", "single-quoted-scalar", "double-quoted-scalar"].includes(node.type!)) {
      if (node.source && typeof node.source !== "string" && await source.find(node.source, "\n") >= 0) return true;
      if (node.end) for await (const token of tree.values(node.end)) if ((await tree.get(token)).type === "newline") return true;
    } else if (node.type === "flow-collection") {
      for await (const itemRef of tree.values(node.items!)) {
        const item = await tree.get(itemRef);
        for (const list of [item.start, item.sep]) if (list) for await (const token of tree.values(list)) if ((await tree.get(token)).type === "newline") return true;
        if (present(item.key)) await tree.push(pending, item.key);
        if (present(item.value)) await tree.push(pending, item.value);
      }
    } else return true;
  }
  return false;
}

/** Emit one child or pair at a time. CST, source spans and traversal scratch stay
 * in caller storage. Scalar/tag resolution and duplicate-key identity are the
 * semantic composer's responsibility. */
export async function* resolveRetainedYamlCollection(source: RetainedSourceText, tree: RetainedYamlCst, ref: number): AsyncGenerator<RetainedYamlEntry> {
  const collection = await tree.get(ref), flow = collection.type === "flow-collection";
  const map = collection.type === "block-map" || flow && (await tree.get(collection.start!)).type === "flow-map-start";
  let offset = collection.offset! + (flow ? 1 : 0), index = 0;
  const count = await tree.count(collection.items!);
  for await (const itemRef of tree.values(collection.items!)) {
    const item = await tree.get(itemRef), key = present(item.key) ? await tree.get(item.key) : undefined, value = present(item.value) ? await tree.get(item.value) : undefined;
    const props = await resolveRetainedYamlProps(source, tree, item.start, {
      flow, indicator: !flow && !map ? "seq-item-ind" : "explicit-key-ind",
      next: !flow && !map ? item.value : key ? item.key : item.sep ? await tree.at(item.sep, 0) : undefined,
      offset, parentIndent: collection.indent!, startOnNewline: !flow
    });
    if (!flow && !map) {
      if (!props.found) {
        if (props.anchor || props.tag || value) throw new RetainedYamlSyntaxError(offset);
        if (props.commentTokens) yield {comment: {target: "collection", tokens: props.commentTokens, replace: true}};
        offset = props.end; continue;
      }
      yield {value: {token: item.value, props}};
      offset = await retainedYamlTokenEnd(tree, item.value, props.end); continue;
    }
    if (flow) {
      if (!props.found && !props.anchor && !props.tag && !item.sep && !value) {
        if (index === 0 && props.comma || index < count - 1) throw new RetainedYamlSyntaxError(props.start);
        if (props.commentTokens) yield {comment: {target: "collection", tokens: props.commentTokens}};
        offset = props.end; index++; continue;
      }
      if (index === 0 ? props.comma !== undefined : props.comma === undefined) throw new RetainedYamlSyntaxError(props.start);
      if (index > 0 && props.commentTokens && item.start) for await (const tokenRef of tree.values(item.start)) {
        const token = await tree.get(tokenRef);
        if (token.type === "comma" || token.type === "space") continue;
        if (token.type === "comment" && yamlCstSourceLength(token) > 1) {
          yield {comment: {target: "previous", tokens: await tree.list(tokenRef)}};
          // Native composition strips the moved comment plus one separator code
          // unit, even when the separator is CRLF or is absent.
          props.commentSkip = yamlCstSourceLength(token);
        }
        break;
      }
      if (!map && !props.found && await containsNewline(source, tree, item.key)) throw new RetainedYamlSyntaxError(props.start);
      if (block(key) || block(value)) throw new RetainedYamlSyntaxError(props.start);
    } else if (!props.found) {
      if (key?.type === "block-seq" || key?.indent !== undefined && key.indent !== collection.indent) throw new RetainedYamlSyntaxError(offset);
      if (!props.anchor && !props.tag && !item.sep) {
        if (props.commentTokens) yield {comment: {target: "collection", tokens: props.commentTokens}};
        offset = props.end; continue;
      }
      if (props.newlineAfterProp || await containsNewline(source, tree, item.key)) throw new RetainedYamlSyntaxError(props.start);
    } else if ((await tree.get(props.found)).indent !== collection.indent) throw new RetainedYamlSyntaxError(offset);
    if (flow && !map && !item.sep && !props.found) {
      yield {value: {token: item.value, props}};
      offset = await retainedYamlTokenEnd(tree, item.value, props.end);
    } else {
      const keyEnd = await retainedYamlTokenEnd(tree, item.key, props.end);
      const valueProps = await resolveRetainedYamlProps(source, tree, item.sep, {
        flow, indicator: "map-value-ind", next: item.value, offset: keyEnd,
        parentIndent: collection.indent!, startOnNewline: !flow && (!key || key.type === "block-scalar")
      });
      if (valueProps.found) {
        if (!props.found && (!flow || !map)) {
          const colon = await tree.get(valueProps.found);
          if (props.start < colon.offset! - 1024 || !flow && value?.type === "block-map" && !valueProps.hasNewline) throw new RetainedYamlSyntaxError(colon.offset!);
          if (flow && item.sep) for await (const tokenRef of tree.values(item.sep)) {
            if (tokenRef === valueProps.found) break;
            if ((await tree.get(tokenRef)).type === "newline") throw new RetainedYamlSyntaxError(colon.offset!);
          }
        }
      } else if (flow ? !!value : !props.found) throw new RetainedYamlSyntaxError(valueProps.start);
      yield {key: {token: present(item.key) ? item.key : undefined, props}, ...(value || valueProps.found ? {value: {token: item.value, props: valueProps}} : valueProps.commentTokens ? {keyComment: valueProps.commentTokens} : {})};
      offset = await retainedYamlTokenEnd(tree, item.value, valueProps.end);
    }
    index++;
  }
  if (flow) {
    const closeRef = collection.end ? await tree.at(collection.end, 0) : undefined;
    const close = closeRef === undefined ? undefined : await tree.get(closeRef);
    if (close?.type !== (map ? "flow-map-end" : "flow-seq-end")) throw new RetainedYamlSyntaxError(offset);
    const end = await resolveRetainedYamlEnd(tree, collection.end, close.offset! + 1, true, 1);
    if (end.commentTokens) yield {comment: {target: "collection", tokens: end.commentTokens}};
  }
}
