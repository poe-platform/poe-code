export type TemplateEscape = "html" | "none";

export interface RenderTemplateOptions {
  escape?: TemplateEscape;
  yield?: string;
}

type Token =
  | { type: "text"; value: string; start: number }
  | { type: "name" | "unescaped"; name: string; raw: string }
  | { type: "section" | "inverted"; name: string; children: Token[]; rawStart: number; rawEnd: number };

interface SectionFrame {
  token: Extract<Token, { type: "section" | "inverted" }>;
  parent: Token[];
}

interface Context {
  view: unknown;
  parent?: Context;
}

type Lambda = (...args: unknown[]) => unknown;

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
  const prepared = options.yield === undefined
    ? template
    : template.split("{{yield}}").join(options.yield);
  const tokens = parseTemplate(prepared);
  const escape = options.escape === "none" ? String : escapeHtml;
  const preserveMissing = options.yield !== undefined && options.escape === "none";

  return renderTokens(tokens, { view }, prepared, escape, preserveMissing);
}

function renderTemplateInContext(
  template: string,
  context: Context,
  escape: (value: string) => string,
  preserveMissing: boolean
): string {
  return renderTokens(parseTemplate(template), context, template, escape, preserveMissing);
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

    if (parsed.kind === "partial") {
      throw new Error(`Partials are not supported: "${parsed.name}"`);
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

function parseTag(template: string, open: number): {
  kind: "name" | "unescaped" | "section" | "inverted" | "close" | "comment" | "partial" | "delimiter";
  name: string;
  end: number;
} {
  if (template.startsWith("{{{", open)) {
    const close = template.indexOf("}}}", open + 3);
    if (close === -1) {
      throw new Error("Unclosed unescaped tag");
    }
    return { kind: "unescaped", name: template.slice(open + 3, close).trim(), end: close + 3 };
  }

  const close = template.indexOf("}}", open + 2);
  if (close === -1) {
    throw new Error("Unclosed tag");
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
  escape: (value: string) => string,
  preserveMissing: boolean
): string {
  let output = "";

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        output += token.value;
        continue;

      case "name":
      case "unescaped": {
        const value = lookup(context, token.name);
        if (value == null) {
          if (preserveMissing) {
            output += token.raw;
          }
          continue;
        }
        const rendered = String(value);
        output += token.type === "name" ? escape(rendered) : rendered;
        continue;
      }

      case "inverted": {
        const value = lookup(context, token.name);
        if (!value || (Array.isArray(value) && value.length === 0)) {
          output += renderTokens(token.children, context, template, escape, preserveMissing);
        }
        continue;
      }

      case "section": {
        const value = lookup(context, token.name);
        if (!value) {
          continue;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            output += renderTokens(token.children, pushContext(context, item), template, escape, preserveMissing);
          }
          continue;
        }

        if (typeof value === "function") {
          const raw = template.slice(token.rawStart, token.rawEnd);
          const rendered = (value as Lambda).call(context.view, raw, (nextTemplate: string) =>
            renderTemplateInContext(nextTemplate, context, escape, preserveMissing)
          );
          if (rendered != null) {
            output += String(rendered);
          }
          continue;
        }

        if (typeof value === "object" || typeof value === "string" || typeof value === "number") {
          output += renderTokens(token.children, pushContext(context, value), template, escape, preserveMissing);
          continue;
        }

        output += renderTokens(token.children, context, template, escape, preserveMissing);
      }
    }
  }

  return output;
}

function lookup(context: Context, name: string): unknown {
  if (name === ".") {
    return callLambda(context.view, context.view);
  }

  let cursor: Context | undefined = context;
  while (cursor !== undefined) {
    const result = name.includes(".")
      ? lookupDotted(cursor.view, name)
      : lookupName(cursor.view, name);

    if (result.hit) {
      return callLambda(result.value, cursor.view);
    }

    cursor = cursor.parent;
  }

  return undefined;
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
