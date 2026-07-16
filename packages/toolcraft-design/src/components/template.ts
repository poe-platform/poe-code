export type TemplateEscape = "html" | "none";

export interface RenderTemplateOptions {
  escape?: TemplateEscape;
  partials?: Record<string, string>;
  validate?: boolean;
  yield?: string;
}

type Token =
  | { type: "text"; value: string; start: number }
  | { type: "name" | "unescaped"; name: string; raw: string }
  | { type: "partial"; name: string; indent: string }
  | {
      type: "section" | "inverted";
      name: string;
      children: Token[];
      rawStart: number;
      rawEnd: number;
    };

interface SectionFrame {
  token: Extract<Token, { type: "section" | "inverted" }>;
  parent: Token[];
}

interface Context {
  view: unknown;
  parent?: Context;
}

type Lambda = (...args: unknown[]) => unknown;

interface RenderState {
  escape: (value: string) => string;
  partials: Record<string, string>;
  partialStack: string[];
  preserveMissing: boolean;
  validate: boolean;
}

const MAX_PARTIAL_DEPTH = 100;

const MAX_TAG_EXCERPT_LENGTH = 40;

export class TemplateParseError extends Error {
  readonly description: string;
  readonly line: number;
  readonly column: number;

  constructor(description: string, position: { line: number; column: number }) {
    super(`${description} at line ${position.line}, column ${position.column}`);
    this.name = "TemplateParseError";
    this.description = description;
    this.line = position.line;
    this.column = position.column;
  }
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;"
};

export function renderTemplate(
  template: string,
  view: Record<string, unknown>,
  options: RenderTemplateOptions = {}
): string {
  const prepared =
    options.yield === undefined
    ? template
      : resolveTemplatePartials(template, options.partials ?? {})
          .split("{{yield}}")
          .join(options.yield);
  const tokens = parseTemplate(prepared);
  validatePartialReferences(tokens, options.partials ?? {}, []);
  if (options.validate === true) {
    const expanded = resolveTemplatePartials(prepared, options.partials ?? {});
    validateVariables(parseTemplate(expanded), { view });
  }
  const state: RenderState = {
    escape: options.escape === "none" ? String : escapeHtml,
    partials: options.partials ?? {},
    partialStack: [],
    preserveMissing: options.yield !== undefined && options.escape === "none",
    validate: options.validate === true
  };

  return renderTokens(tokens, { view }, prepared, state);
}

export function getTemplatePartialNames(template: string): string[] {
  const names = new Set<string>();
  collectPartialNames(parseTemplate(template), names);
  return [...names];
}

export function resolveTemplatePartials(
  template: string,
  partials: Record<string, string>
): string {
  return expandTemplatePartials(template, partials, []);
}

function renderTemplateInContext(template: string, context: Context, state: RenderState): string {
  return renderTokens(parseTemplate(template), context, template, state);
}

function parseTemplate(template: string): Token[] {
  const root: Token[] = [];
  const stack: SectionFrame[] = [];
  let tokens = root;
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf("{{", index);
    if (open === -1) {
      appendText(tokens, template.slice(index), index);
      break;
    }

    appendText(tokens, template.slice(index, open), index);

    const parsed = parseTag(template, open);
    const standalone = getStandalone(template, open, parsed.end, parsed.kind);
    if (standalone !== undefined) {
      trimTextAfter(tokens, standalone.lineStart);
    }

    if (parsed.kind === "comment") {
      index = standalone?.nextIndex ?? parsed.end;
      continue;
    }

    if (parsed.kind === "delimiter") {
      throw new Error("Custom delimiters are not supported");
    }

    if (parsed.kind === "section" || parsed.kind === "inverted") {
      const token: Token = {
        type: parsed.kind,
        name: parsed.name,
        children: [],
        rawStart: parsed.end,
        rawEnd: standalone?.lineStart ?? open
      };
      tokens.push(token);
      stack.push({ token, parent: tokens });
      tokens = token.children;
      index = standalone?.nextIndex ?? parsed.end;
      continue;
    }

    if (parsed.kind === "partial") {
      tokens.push({
        type: "partial",
        name: parsed.name,
        indent: standalone === undefined ? "" : template.slice(standalone.lineStart, open)
      });
      index = standalone?.nextIndex ?? parsed.end;
      continue;
    }

    if (parsed.kind === "close") {
      const frame = stack.pop();
      if (frame === undefined) {
        throw new Error(`Closing unopened section "${parsed.name}"`);
      }
      if (frame.token.name !== parsed.name) {
        throw new Error(`Unclosed section "${frame.token.name}" before closing "${parsed.name}"`);
      }
      frame.token.rawEnd = open;
      tokens = frame.parent;
      index = standalone?.nextIndex ?? parsed.end;
      continue;
    }

    tokens.push({ type: parsed.kind, name: parsed.name, raw: template.slice(open, parsed.end) });
    index = parsed.end;
  }

  const frame = stack.pop();
  if (frame !== undefined) {
    throw new Error(`Unclosed section "${frame.token.name}"`);
  }

  return root;
}

function parseTag(
  template: string,
  open: number
): {
  kind:
    | "name"
    | "unescaped"
    | "section"
    | "inverted"
    | "close"
    | "comment"
    | "partial"
    | "delimiter";
  name: string;
  end: number;
} {
  if (template.startsWith("{{{", open)) {
    const close = template.indexOf("}}}", open + 3);
    if (close === -1) {
      throw unclosedTagError(template, open, "}}}");
    }
    return { kind: "unescaped", name: template.slice(open + 3, close).trim(), end: close + 3 };
  }

  const close = template.indexOf("}}", open + 2);
  if (close === -1) {
    throw unclosedTagError(template, open, "}}");
  }

  const raw = template.slice(open + 2, close).trim();
  const sigil = raw[0];
  const name = sigil === undefined ? "" : raw.slice(1).trim();
  const end = close + 2;

  if (sigil === "#") return { kind: "section", name, end };
  if (sigil === "^") return { kind: "inverted", name, end };
  if (sigil === "/") return { kind: "close", name, end };
  if (sigil === "!") return { kind: "comment", name, end };
  if (sigil === "&") return { kind: "unescaped", name, end };
  if (sigil === ">") return { kind: "partial", name, end };
  if (sigil === "=" && raw.endsWith("=")) return { kind: "delimiter", name, end };

  return { kind: "name", name: raw, end };
}

function unclosedTagError(template: string, open: number, expected: string): TemplateParseError {
  const before = template.slice(0, open);
  const lineEnd = template.indexOf("\n", open);
  const opened = template.slice(open, lineEnd === -1 ? template.length : lineEnd).trimEnd();
  const tag =
    opened.length > MAX_TAG_EXCERPT_LENGTH
      ? `${opened.slice(0, MAX_TAG_EXCERPT_LENGTH)}...`
      : opened;

  return new TemplateParseError(`Unclosed tag "${tag}": expected "${expected}"`, {
    line: before.split("\n").length,
    column: open - (before.lastIndexOf("\n") + 1) + 1
  });
}

function getStandalone(
  template: string,
  tagStart: number,
  tagEnd: number,
  kind: ReturnType<typeof parseTag>["kind"]
): { lineStart: number; nextIndex: number } | undefined {
  if (!["section", "inverted", "close", "comment", "partial", "delimiter"].includes(kind)) {
    return undefined;
  }

  const lineStart = template.lastIndexOf("\n", tagStart - 1) + 1;
  if (!isWhitespace(template.slice(lineStart, tagStart))) {
    return undefined;
  }

  let cursor = tagEnd;
  while (cursor < template.length && (template[cursor] === " " || template[cursor] === "\t")) {
    cursor += 1;
  }

  if (template.startsWith("\r\n", cursor)) {
    return { lineStart, nextIndex: cursor + 2 };
  }

  if (template[cursor] === "\n") {
    return { lineStart, nextIndex: cursor + 1 };
  }

  if (cursor === template.length) {
    return { lineStart, nextIndex: cursor };
  }

  return undefined;
}

function renderTokens(
  tokens: Token[],
  context: Context,
  template: string,
  state: RenderState
): string {
  let output = "";

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        output += token.value;
        continue;

      case "name":
      case "unescaped": {
        const result = lookup(context, token.name);
        if (!result.hit || result.value == null) {
          if (state.validate) {
            throw new Error(`Template variable "${token.name}" not found.`);
          }
          if (state.preserveMissing) {
            output += token.raw;
          }
          continue;
        }
        const rendered = String(result.value);
        output += token.type === "name" ? state.escape(rendered) : rendered;
        continue;
      }

      case "partial": {
        if (!Object.hasOwn(state.partials, token.name)) {
          throw new Error(`Partial "${token.name}" not found.`);
        }
        if (state.partialStack.includes(token.name)) {
          throw new Error(
            `Circular partial reference detected: ${[...state.partialStack, token.name].join(" -> ")}.`
          );
        }
        if (state.partialStack.length >= MAX_PARTIAL_DEPTH) {
          throw new Error(`Maximum partial depth exceeded (${MAX_PARTIAL_DEPTH}).`);
        }

        const partial = indentPartial(state.partials[token.name], token.indent);
        output += renderTokens(parseTemplate(partial), context, partial, {
          ...state,
          partialStack: [...state.partialStack, token.name]
        });
        continue;
      }

      case "inverted": {
        const result = lookup(context, token.name);
        if (!result.hit && state.validate) {
          throw new Error(`Template variable "${token.name}" not found.`);
        }
        const value = result.value;
        if (!value || (Array.isArray(value) && value.length === 0)) {
          output += renderTokens(token.children, context, template, state);
        }
        continue;
      }

      case "section": {
        const result = lookup(context, token.name);
        if (!result.hit && state.validate) {
          throw new Error(`Template variable "${token.name}" not found.`);
        }
        const value = result.value;
        if (!value) {
          continue;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            output += renderTokens(token.children, pushContext(context, item), template, state);
          }
          continue;
        }

        if (typeof value === "function") {
          const raw = template.slice(token.rawStart, token.rawEnd);
          const rendered = (value as Lambda).call(context.view, raw, (nextTemplate: string) =>
            renderTemplateInContext(nextTemplate, context, state)
          );
          if (rendered != null) {
            output += String(rendered);
          }
          continue;
        }

        if (typeof value === "object" || typeof value === "string" || typeof value === "number") {
          output += renderTokens(token.children, pushContext(context, value), template, state);
          continue;
        }

        output += renderTokens(token.children, context, template, state);
      }
    }
  }

  return output;
}

function lookup(context: Context, name: string): { hit: boolean; value: unknown } {
  if (name === ".") {
    return { hit: true, value: callLambda(context.view, context.view) };
  }

  let cursor: Context | undefined = context;
  while (cursor !== undefined) {
    const result = name.includes(".")
      ? lookupDotted(cursor.view, name)
      : lookupName(cursor.view, name);

    if (result.hit) {
      return { hit: true, value: callLambda(result.value, cursor.view) };
    }

    cursor = cursor.parent;
  }

  return { hit: false, value: undefined };
}

function collectPartialNames(tokens: Token[], names: Set<string>): void {
  for (const token of tokens) {
    if (token.type === "partial") {
      names.add(token.name);
      continue;
    }
    if (token.type === "section" || token.type === "inverted") {
      collectPartialNames(token.children, names);
    }
  }
}

function validateVariables(tokens: Token[], context: Context): void {
  for (const token of tokens) {
    if (token.type === "text" || token.type === "partial") {
      continue;
    }
    if (token.type === "name" || token.type === "unescaped") {
      if (!lookup(context, token.name).hit) {
        throw new Error(`Template variable "${token.name}" not found.`);
      }
      continue;
    }
    if (token.type !== "section" && token.type !== "inverted") {
      continue;
    }

    const result = lookup(context, token.name);
    if (!result.hit) {
      throw new Error(`Template variable "${token.name}" not found.`);
    }
    if (Array.isArray(result.value) && result.value.length > 0) {
      for (const item of result.value) {
        validateVariables(token.children, pushContext(context, item));
      }
      continue;
    }
    if (
      typeof result.value === "object" && result.value !== null ||
      typeof result.value === "string" ||
      typeof result.value === "number"
    ) {
      validateVariables(token.children, pushContext(context, result.value));
      continue;
    }

    validateVariables(token.children, context);
  }
}

function validatePartialReferences(
  tokens: Token[],
  partials: Record<string, string>,
  partialStack: string[]
): void {
  for (const token of tokens) {
    if (token.type === "section" || token.type === "inverted") {
      validatePartialReferences(token.children, partials, partialStack);
      continue;
    }
    if (token.type !== "partial") {
      continue;
    }
    if (!Object.hasOwn(partials, token.name)) {
      throw new Error(`Partial "${token.name}" not found.`);
    }
    if (partialStack.includes(token.name)) {
      throw new Error(
        `Circular partial reference detected: ${[...partialStack, token.name].join(" -> ")}.`
      );
    }
    if (partialStack.length >= MAX_PARTIAL_DEPTH) {
      throw new Error(`Maximum partial depth exceeded (${MAX_PARTIAL_DEPTH}).`);
    }

    validatePartialReferences(parseTemplate(partials[token.name]), partials, [
      ...partialStack,
      token.name
    ]);
  }
}

function indentPartial(partial: string, indent: string): string {
  if (indent === "") {
    return partial;
  }

  return partial
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}${line}`))
    .join("\n");
}

function expandTemplatePartials(
  template: string,
  partials: Record<string, string>,
  partialStack: string[]
): string {
  let output = "";
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf("{{", index);
    if (open === -1) {
      output += template.slice(index);
      break;
    }

    const parsed = parseTag(template, open);
    if (parsed.kind !== "partial") {
      output += template.slice(index, parsed.end);
      index = parsed.end;
      continue;
    }

    if (!Object.hasOwn(partials, parsed.name)) {
      throw new Error(`Partial "${parsed.name}" not found.`);
    }
    if (partialStack.includes(parsed.name)) {
      throw new Error(
        `Circular partial reference detected: ${[...partialStack, parsed.name].join(" -> ")}.`
      );
    }
    if (partialStack.length >= MAX_PARTIAL_DEPTH) {
      throw new Error(`Maximum partial depth exceeded (${MAX_PARTIAL_DEPTH}).`);
    }

    const standalone = getStandalone(template, open, parsed.end, parsed.kind);
    const beforePartial =
      standalone === undefined
        ? template.slice(index, open)
        : template.slice(index, standalone.lineStart);
    const indent = standalone === undefined ? "" : template.slice(standalone.lineStart, open);
    const partial = indentPartial(partials[parsed.name], indent);
    output +=
      beforePartial + expandTemplatePartials(partial, partials, [...partialStack, parsed.name]);
    index = standalone?.nextIndex ?? parsed.end;
  }

  return output;
}

function lookupName(view: unknown, name: string): { hit: boolean; value: unknown } {
  if (!isPropertyContainer(view) || !hasProperty(view, name)) {
    return { hit: false, value: undefined };
  }

  return { hit: true, value: view[name] };
}

function lookupDotted(view: unknown, name: string): { hit: boolean; value: unknown } {
  const parts = name.split(".");
  let value = view;

  for (const part of parts) {
    if (!isPropertyContainer(value) || !hasProperty(value, part)) {
      return { hit: false, value: undefined };
    }
    value = Object(value)[part as keyof typeof value];
  }

  return { hit: true, value };
}

function callLambda(value: unknown, view: unknown): unknown {
  return typeof value === "function" ? (value as Lambda).call(view) : value;
}

function pushContext(parent: Context, view: unknown): Context {
  return { view, parent };
}

function appendText(tokens: Token[], value: string, start: number): void {
  if (value === "") {
    return;
  }

  const previous = tokens[tokens.length - 1];
  if (previous?.type === "text") {
    previous.value += value;
    return;
  }

  tokens.push({ type: "text", value, start });
}

function trimTextAfter(tokens: Token[], lineStart: number): void {
  const previous = tokens[tokens.length - 1];
  if (previous?.type !== "text") {
    return;
  }

  const keep = Math.max(0, lineStart - previous.start);
  previous.value = previous.value.slice(0, keep);
  if (previous.value === "") {
    tokens.pop();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`=/]/g, (char) => HTML_ESCAPE[char] ?? char);
}

function isWhitespace(value: string): boolean {
  return value.trim() === "";
}

function isPropertyContainer(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function hasProperty(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
