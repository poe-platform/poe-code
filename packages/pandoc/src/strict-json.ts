import type { AdapterContext } from "./types.js";

/** Strict JSON with bounded intermediate ownership and checkpoints inside tokens.
 * Error policy belongs to the reader; no synchronous whole-document fallback. */
export async function parseStrictJson(
  text: string,
  context: AdapterContext,
  error: (offset: number, message: string) => never,
  number: (token: string, value: number, offset: number) => void = () => {}
): Promise<unknown> {
  let cursor = 0, nodes = 0;
  const step = async (): Promise<string> => {
    await context.cooperate();
    return text[cursor++]!;
  };
  const skip = async (): Promise<void> => {
    while ([" ", "\t", "\r", "\n"].includes(text[cursor] ?? "")) await step();
  };
  const node = (): void => {
    context.checkpoint();
    context.bound("nodes", ++nodes);
    context.charge("retainedBytes", 16);
  };
  const string = async (): Promise<string> => {
    await step(); // opening quote
    let fragment = "", length = 0;
    const parts: string[] = [];
    const append = (value: string): void => {
      context.bound("text", ++length);
      context.charge("retainedBytes", 2);
      if (!fragment) context.charge("references", 1);
      fragment += value;
      if (fragment.length === 2048) { parts.push(fragment); fragment = ""; }
    };
    while (cursor < text.length) {
      const c = await step();
      if (c === '"') {
        if (fragment) parts.push(fragment);
        context.charge("retainedBytes", length * 2);
        return parts.join("");
      }
      if (c.charCodeAt(0) < 32) error(cursor - 1, "Invalid JSON string control");
      if (c !== "\\") { append(c); continue; }
      if (cursor === text.length) error(cursor, "Incomplete JSON escape");
      const escape = await step();
      const escapes: Readonly<Record<string, string>> = {
        '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t"
      };
      if (Object.hasOwn(escapes, escape)) { append(escapes[escape]!); continue; }
      if (escape !== "u") error(cursor - 1, "Invalid JSON escape");
      let code = 0;
      for (let i = 0; i < 4; i++) {
        if (cursor === text.length) error(cursor, "Incomplete JSON Unicode escape");
        const digit = (await step()).toLowerCase();
        const value = "0123456789abcdef".indexOf(digit);
        if (value < 0) error(cursor - 1, "Invalid JSON Unicode escape");
        code = code * 16 + value;
      }
      append(String.fromCharCode(code));
    }
    return error(cursor, "Unterminated JSON string");
  };
  const digit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
  const value = async (depth: number): Promise<unknown> => {
    context.bound("depth", depth);
    await skip();
    node();
    const c = text[cursor];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      const object = c === "{";
      await step();
      const result: Record<string, unknown> | unknown[] = object
        ? Object.create(null) as Record<string, unknown> : [];
      const end = object ? "}" : "]";
      await skip();
      if (text[cursor] === end) { await step(); return result; }
      while (cursor < text.length) {
        await skip();
        let key = "";
        if (object) {
          if (text[cursor] !== '"') error(cursor, "Expected JSON property");
          const offset = cursor;
          node();
          key = await string();
          if (Object.hasOwn(result, key)) error(offset, `Duplicate object key: ${key}`);
          await skip();
          if (text[cursor] !== ":") error(cursor, "Expected JSON colon");
          await step();
        }
        context.charge("references", 1);
        context.charge("retainedBytes", 16);
        const child = await value(depth + 1);
        if (object) (result as Record<string, unknown>)[key] = child;
        else (result as unknown[]).push(child);
        await skip();
        if (text[cursor] === end) { await step(); return result; }
        if (text[cursor] !== ",") error(cursor, "Expected JSON comma");
        await step();
      }
      return error(cursor, "Unterminated JSON container");
    }
    for (const [token, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (c !== token[0]) continue;
      for (const expected of token) if (await step() !== expected) error(cursor - 1, "Invalid JSON literal");
      return literal;
    }
    if (c === "-" || digit(c)) {
      const start = cursor;
      if (c === "-") await step();
      if (text[cursor] === "0") await step();
      else {
        if (!digit(text[cursor])) error(cursor, "Invalid JSON number");
        while (digit(text[cursor])) await step();
      }
      if (text[cursor] === ".") {
        await step();
        if (!digit(text[cursor])) error(cursor, "Invalid JSON fraction");
        while (digit(text[cursor])) await step();
      }
      if (text[cursor] === "e" || text[cursor] === "E") {
        await step();
        if (text[cursor] === "+" || text[cursor] === "-") await step();
        if (!digit(text[cursor])) error(cursor, "Invalid JSON exponent");
        while (digit(text[cursor])) await step();
      }
      context.charge("retainedBytes", (cursor - start) * 2);
      const token = text.slice(start, cursor), numeric = Number(token);
      number(token, numeric, start);
      return numeric;
    }
    return error(cursor, "Expected JSON value");
  };
  const result = await value(0);
  await skip();
  if (cursor !== text.length) error(cursor, "Unexpected JSON suffix");
  context.checkpoint(0);
  return result;
}
