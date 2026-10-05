/*!
 * YAML property validation adapted from yaml 2.9.0.
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
import type {RetainedYamlCst, YamlCstNode, YamlCstType} from "./retained-yaml-cst.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";

export interface RetainedYamlProps {
  anchor?: number;
  tag?: number;
  found?: number;
  comma?: number;
  newlineAfterProp?: number;
  hasNewline: boolean;
  comment: boolean;
  start: number;
  end: number;
}
export function yamlCstSourceLength(token: YamlCstNode): number {
  return typeof token.source === "string" ? token.source.length : token.source ? token.source.end - token.source.start : 0;
}

/** Validate property ordering and separation without collecting comments.
 * Metadata discards presentation comments; only their presence and offsets are
 * needed for composition, including the range of an empty scalar. */
export async function resolveRetainedYamlProps(source: RetainedSourceText, tree: RetainedYamlCst, tokens: number | undefined,
  options: {flow?: boolean; indicator: YamlCstType; next?: number | undefined; offset: number; parentIndent: number; startOnNewline: boolean}): Promise<RetainedYamlProps> {
  let atNewline = options.startOnNewline, hasSpace = options.startOnNewline, reqSpace = false, tab = 0;
  const result: RetainedYamlProps = {hasNewline: false, comment: false, start: options.offset, end: options.offset};
  let start: number | undefined;
  const next = options.next && options.next !== -1 ? await tree.get(options.next) : undefined;
  if (tokens) for await (const ref of tree.values(tokens)) {
    const token = await tree.get(ref), offset = token.offset!;
    if (reqSpace) {
      if (token.type !== "space" && token.type !== "newline" && token.type !== "comma") throw new RetainedYamlSyntaxError(offset);
      reqSpace = false;
    }
    if (tab) {
      if (atNewline && token.type !== "comment" && token.type !== "newline") throw new RetainedYamlSyntaxError((await tree.get(tab)).offset!);
      tab = 0;
    }
    switch (token.type) {
      case "space":
        if (!options.flow && (options.indicator !== "doc-start" || next?.type !== "flow-collection") && token.source && typeof token.source !== "string" && await source.find(token.source, "\t") >= 0) tab = ref;
        hasSpace = true; break;
      case "comment":
        if (!hasSpace) throw new RetainedYamlSyntaxError(offset);
        result.comment = true; atNewline = false; break;
      case "newline":
        atNewline = true; result.hasNewline = true;
        if (result.anchor || result.tag) result.newlineAfterProp = ref;
        hasSpace = true; break;
      case "anchor":
        if (result.anchor) throw new RetainedYamlSyntaxError(offset);
        result.anchor = ref; start ??= offset; atNewline = false; hasSpace = false; reqSpace = true; break;
      case "tag":
        if (result.tag) throw new RetainedYamlSyntaxError(offset);
        result.tag = ref; start ??= offset; atNewline = false; hasSpace = false; reqSpace = true; break;
      case options.indicator:
        if (result.anchor || result.tag || result.found) throw new RetainedYamlSyntaxError(offset);
        result.found = ref; atNewline = options.indicator === "seq-item-ind" || options.indicator === "explicit-key-ind"; hasSpace = false; break;
      case "comma":
        if (!options.flow || result.comma) throw new RetainedYamlSyntaxError(offset);
        result.comma = ref; atNewline = false; hasSpace = false; break;
      default: throw new RetainedYamlSyntaxError(offset);
    }
    result.end = offset + yamlCstSourceLength(token);
  }
  if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || yamlCstSourceLength(next) !== 0)) throw new RetainedYamlSyntaxError(next.offset!);
  if (tab) {
    const token = await tree.get(tab);
    if (atNewline && token.indent! <= options.parentIndent || next?.type === "block-map" || next?.type === "block-seq") throw new RetainedYamlSyntaxError(token.offset!);
  }
  result.start = start ?? result.end;
  return result;
}

/** Node-end comments need only separation validation and range accounting.
 * skip selects the tail after a flow collection's closing delimiter. */
export async function resolveRetainedYamlEnd(tree: RetainedYamlCst, tokens: number | undefined, offset: number, requireSpace: boolean, skip = 0): Promise<number> {
  let hasSpace = false;
  if (tokens) for await (const ref of tree.values(tokens)) {
    if (skip > 0) {skip--; continue;}
    const token = await tree.get(ref);
    if (token.type === "space" || token.type === "newline") hasSpace = true;
    else if (token.type === "comment") {if (requireSpace && !hasSpace) throw new RetainedYamlSyntaxError(token.offset!);}
    else throw new RetainedYamlSyntaxError(token.offset!);
    offset += yamlCstSourceLength(token);
  }
  return offset;
}
