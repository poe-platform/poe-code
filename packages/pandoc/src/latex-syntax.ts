import { PandocError } from "./errors.js";
import type { AdapterContext } from "./types.js";

export type TexToken =
  | {kind: "text" | "space" | "comment" | "command" | "code"; text: string; raw: string}
  | {kind: "group" | "optional" | "environment"; text: string; raw: string; children: TexToken[]}
  | {kind: "math"; text: string; raw: string; display: boolean};
export const forbiddenTex = new Set([
  "catcode", "write", "directlua", "luaexec", "def", "gdef", "edef", "xdef", "csname", "endcsname",
  "usepackage", "RequirePackage", "openout", "openin", "closeout", "closein", "read", "special",
  "immediate", "shipout", "global", "let", "futurelet", "expandafter", "noexpand", "scantokens",
  "everypar", "everyjob", "loop", "repeat", "if", "ifnum", "ifx", "unless", "includeonly"
]);
const letter = (c: string) => c >= "a" && c <= "z" || c >= "A" && c <= "Z";
const whitespace = (c: string) => " \t\r\n".includes(c) && c !== "";
export function texError(context: AdapterContext, message: string, code: "E_PARSE" | "E_CAPABILITY" | "E_LIMIT" | "E_RESOURCE" = "E_PARSE"): never {
  throw new PandocError(code, context.operation ?? "read", message, "latex");
}

/** A lexical/group/environment parser, deliberately independent of TeX execution. */
export async function parseTex(source: string, context: AdapterContext): Promise<TexToken[]> {
  context.checkpoint(0);
  context.charge("retainedBytes", source.length * 4);
  let cursor = 0;
  async function command(): Promise<string> {
    cursor++;
    const start = cursor;
    if (letter(source[cursor] ?? "")) while (letter(source[cursor] ?? "")) {await context.cooperate(); cursor++;}
    else if (cursor < source.length) cursor++;
    else texError(context, "Command at EOF");
    const name = source.slice(start, cursor);
    if (forbiddenTex.has(name)) texError(context, `Forbidden TeX primitive: ${name}`, "E_CAPABILITY");
    return name;
  }
  async function skip(): Promise<void> {
    while (cursor < source.length) {
      if (whitespace(source[cursor]!)) {await context.cooperate(); cursor++;}
      else if (source[cursor] === "%") {while (cursor < source.length && source[cursor] !== "\n") {await context.cooperate(); cursor++;}}
      else break;
    }
  }
  async function environmentName(): Promise<string> {
    await skip();
    if (source[cursor++] !== "{") texError(context, "Expected environment name group");
    const start = cursor;
    while (cursor < source.length && source[cursor] !== "}") {
      await context.cooperate();
      if (!letter(source[cursor]!) && source[cursor] !== "*") texError(context, "Invalid environment name");
      cursor++;
    }
    if (cursor === source.length) texError(context, "Environment name at EOF");
    const name = source.slice(start, cursor++);
    if (!name) texError(context, "Empty environment name");
    return name;
  }
  async function math(end: string, display: boolean, start: number): Promise<TexToken> {
    const content = cursor;
    let nesting = 0;
    while (cursor < source.length) {
      await context.cooperate();
      if (source.startsWith(end, cursor) && nesting === 0) {
        const text = source.slice(content, cursor);
        cursor += end.length;
        return {kind: "math", text, raw: source.slice(start, cursor), display};
      }
      if (source[cursor] === "%") {while (cursor < source.length && source[cursor] !== "\n") {await context.cooperate(); cursor++;} continue;}
      if (source[cursor] === "\\") {
        if (source.startsWith("\\)", cursor) || source.startsWith("\\]", cursor)) texError(context, "Mismatched math delimiter");
        await command();
      } else {
        if (source[cursor] === "$" && !end.startsWith("\\end")) texError(context, "Mismatched dollar delimiter");
        if (source[cursor] === "{") {nesting++; context.bound("depth", nesting);}
        if (source[cursor] === "}" && --nesting < 0) texError(context, "Unmatched math group");
        cursor++;
      }
    }
    return texError(context, "Math at EOF");
  }
  async function sequence(depth: number, close?: string, env?: string): Promise<TexToken[]> {
    context.bound("depth", depth);
    const result: TexToken[] = [];
    while (cursor < source.length) {
      await context.cooperate();
      const start = cursor;
      const c = source[cursor]!;
      if (close && c === close) {cursor++; return result;}
      if (c === "}") texError(context, "Unmatched closing group");
      context.charge("nodes", 1);
      context.charge("references", 1);
      context.charge("retainedBytes", 32);
      let token: TexToken;
      if (c === "%") {
        while (cursor < source.length && source[cursor] !== "\n") {await context.cooperate(); cursor++;}
        if (source[cursor] === "\n") cursor++;
        token = {kind: "comment", text: "", raw: source.slice(start, cursor)};
      } else if (whitespace(c)) {
        while (whitespace(source[cursor] ?? "")) {await context.cooperate(); cursor++;}
        token = {kind: "space", text: source.slice(start, cursor), raw: source.slice(start, cursor)};
      } else if (c === "{" || c === "[") {
        cursor++;
        const children = await sequence(depth + 1, c === "{" ? "}" : "]");
        context.charge("retainedBytes", (cursor - start) * 2);
        token = {kind: c === "{" ? "group" : "optional", text: "", children, raw: source.slice(start, cursor)};
      } else if (c === "$") {
        const display = source[cursor + 1] === "$";
        cursor += display ? 2 : 1;
        token = await math(display ? "$$" : "$", display, start);
      } else if (c === "\\") {
        const name = await command();
        if (name === "end") {
          const end = await environmentName();
          if (!env || env !== end) texError(context, `Mismatched environment end: ${end}`);
          return result;
        }
        if (name === "begin") {
          const name = await environmentName();
          if (name === "verbatim" || name === "verbatim*") {
            const terminator = `\\end{${name}}`;
            const content = cursor;
            while (cursor < source.length && !source.startsWith(terminator, cursor)) {await context.cooperate(); cursor++;}
            if (cursor === source.length) texError(context, "Verbatim environment at EOF");
            const end = cursor;
            cursor += terminator.length;
            let text = source.slice(content, end);
            if (text.startsWith("\n")) text = text.slice(1);
            token = {kind: "environment", text: name, raw: source.slice(start, cursor), children: [{kind: "code", text, raw: text}]};
          } else if (["equation", "equation*", "displaymath", "math", "align", "align*"].includes(name)) {
            token = await math(`\\end{${name}}`, name !== "math", start);
          } else {
            const children = await sequence(depth + 1, undefined, name);
            context.charge("retainedBytes", (cursor - start) * 2);
            token = {kind: "environment", text: name, raw: source.slice(start, cursor), children};
          }
        } else if (name === "(" || name === "[") token = await math(name === "(" ? "\\)" : "\\]", name === "[", start);
        else if (name === ")" || name === "]") return texError(context, "Unmatched math end");
        else if (name === "verb") {
          if (source[cursor] === "*") cursor++;
          const delimiter = source[cursor++];
          if (!delimiter || whitespace(delimiter) || letter(delimiter)) texError(context, "Invalid verb delimiter");
          const content = cursor;
          while (cursor < source.length && source[cursor] !== delimiter && source[cursor] !== "\n") {await context.cooperate(); cursor++;}
          if (source[cursor] !== delimiter) texError(context, "Inline verbatim at EOF or newline");
          const text = source.slice(content, cursor++);
          token = {kind: "code", text, raw: source.slice(start, cursor)};
        } else token = {kind: "command", text: name, raw: source.slice(start, cursor)};
      } else {
        cursor++;
        // Keep structural table/list punctuation and stars separate.
        if (!"&*#]".includes(c)) while (cursor < source.length && !"\\{}[$%&*#] \t\r\n".includes(source[cursor]!)) {await context.cooperate(); cursor++;}
        token = {kind: "text", text: source.slice(start, cursor), raw: source.slice(start, cursor)};
      }
      result.push(token);
    }
    if (close || env) texError(context, `Unclosed ${env ?? close} at EOF`);
    return result;
  }
  return sequence(0);
}

export class TexCursor {
  index = 0;
  constructor(readonly tokens: readonly TexToken[], readonly context: AdapterContext) {}
  skip(): void {while (this.tokens[this.index]?.kind === "space" || this.tokens[this.index]?.kind === "comment") this.index++;}
  optional(): TexToken | undefined {const saved = this.index; this.skip(); if (this.tokens[this.index]?.kind === "optional") return this.tokens[this.index++]; this.index = saved; return undefined;}
  group(): Extract<TexToken, {children: TexToken[]}> {
    this.skip();
    const token = this.tokens[this.index++];
    if (token?.kind !== "group") return texError(this.context, "Expected required argument group");
    return token;
  }
  argumentsRaw(): string {
    let raw = "";
    while (this.index < this.tokens.length) {
      const saved = this.index;
      this.skip();
      const t = this.tokens[this.index];
      if (t?.kind !== "group" && t?.kind !== "optional") {this.index = saved; break;}
      raw += this.tokens.slice(saved, ++this.index).map(t => t.raw).join("");
    }
    return raw;
  }
}
export function texSource(tokens: readonly TexToken[]): string {return tokens.map(t => t.raw).join("");}
