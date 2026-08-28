import { JqLimitError, objectKeys, wellFormed, type Json } from "../structured/limits.js";
import { Decimal, isNumber, numberText } from "../structured/numbers.js";
import type { YqOwnedWork } from "../structured/query-core.js";
import { YqValueFailure } from "../structured/query-core.js";

class Fragments {
  readonly parts: string[] = [];
  bytes = 0;

  constructor(
    readonly work: YqOwnedWork,
    readonly maxBytes: number,
  ) {}

  async append(fragment: string): Promise<void> {
    const bytes = Buffer.byteLength(fragment);
    if (bytes > this.maxBytes - this.bytes) throw new JqLimitError("maxOutputBytes");
    if (bytes > 0) await this.work.charge(Math.ceil(bytes / 1024));
    this.work.assertOpen();
    this.parts.push(fragment);
    this.bytes += bytes;
  }

  async indent(depth: number): Promise<void> {
    const bytes = depth * 2;
    if (!Number.isSafeInteger(bytes) || bytes > this.maxBytes - this.bytes) throw new JqLimitError("maxOutputBytes");
    if (bytes > 0) await this.work.charge(Math.ceil(bytes / 1024));
    this.work.assertOpen();
    this.parts.push("  ".repeat(depth));
    this.bytes += bytes;
  }

  finish(): string {
    this.work.assertOpen();
    return this.parts.join("");
  }
}

function yamlEscape(codePoint: number): string {
  if (codePoint === 0) return "\\u0000";
  if (codePoint === 0x22) return "\\\"";
  if (codePoint === 0x5c) return "\\\\";
  if (codePoint === 0x08) return "\\b";
  if (codePoint === 0x09) return "\\t";
  if (codePoint === 0x0a) return "\\n";
  if (codePoint === 0x0c) return "\\f";
  if (codePoint === 0x0d) return "\\r";
  if (codePoint === 0x1b) return "\\e";
  if (codePoint < 0x20 || codePoint === 0x7f || codePoint >= 0x80 && codePoint <= 0x9f || codePoint === 0xfffe || codePoint === 0xffff) {
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    return `\\U${codePoint.toString(16).padStart(8, "0")}`;
  }
  return String.fromCodePoint(codePoint);
}

async function quoted(text: string, output: Fragments): Promise<void> {
  if (!wellFormed(text)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
  await output.append('"');
  let fragment = "";
  let codePoints = 0;
  for (const character of text) {
    fragment += yamlEscape(character.codePointAt(0)!);
    codePoints++;
    if (codePoints === 256) {
      await output.work.charge(codePoints);
      output.work.assertOpen();
      await output.append(fragment);
      output.work.assertOpen();
      fragment = "";
      codePoints = 0;
    }
  }
  if (codePoints > 0) {
    await output.work.charge(codePoints);
    output.work.assertOpen();
    await output.append(fragment);
  }
  output.work.assertOpen();
  await output.append('"');
}

function isCollection(value: Json): value is Json[] | Record<string, Json> {
  return value !== null && typeof value === "object" && !(value instanceof Decimal);
}

function nonemptyCollection(value: Json): boolean {
  if (!isCollection(value)) return false;
  return Array.isArray(value) ? value.length > 0 : objectKeys(value).length > 0;
}

async function inline(value: Json, output: Fragments): Promise<void> {
  await output.work.charge(1);
  output.work.assertOpen();
  if (value === null || typeof value === "boolean") await output.append(JSON.stringify(value));
  else if (typeof value === "number" || value instanceof Decimal) {
    const numeric = value instanceof Decimal ? value.double : value;
    if (!Number.isFinite(numeric)) throw new YqValueFailure("SCHEMA_NONFINITE_NUMBER");
    if (Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) throw new YqValueFailure("SCHEMA_UNSAFE_INTEGER");
    await output.append(numberText(value));
  } else if (typeof value === "string") await quoted(value, output);
  else if (Array.isArray(value) && value.length === 0) await output.append("[]");
  else if (!Array.isArray(value) && objectKeys(value).length === 0) await output.append("{}");
  else throw new YqValueFailure("ENCODE_UNSUPPORTED_VALUE");
}

async function mappingBlock(value: Record<string, Json>, output: Fragments, depth: number, firstInline: boolean): Promise<void> {
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index++) {
    if (index > 0) await output.append("\n");
    if (!(firstInline && index === 0)) await output.indent(depth);
    await quoted(keys[index]!, output);
    await output.append(":");
    const item = value[keys[index]!]!;
    if (nonemptyCollection(item)) {
      await output.append("\n");
      await block(item, output, depth + 1);
    } else {
      await output.append(" ");
      await inline(item, output);
    }
  }
}

async function block(value: Json, output: Fragments, depth: number): Promise<void> {
  await output.work.charge(1);
  output.work.assertOpen();
  if (!nonemptyCollection(value)) {
    await output.indent(depth);
    await inline(value, output);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (index > 0) await output.append("\n");
      await output.indent(depth);
      await output.append("-");
      const item = value[index]!;
      if (isCollection(item) && !Array.isArray(item) && objectKeys(item).length > 0) {
        await output.work.charge(1);
        output.work.assertOpen();
        await output.append(" ");
        await mappingBlock(item, output, depth + 1, true);
      } else if (nonemptyCollection(item)) {
        await output.append("\n");
        await block(item, output, depth + 1);
      } else {
        await output.append(" ");
        await inline(item, output);
      }
    }
    return;
  }
  await mappingBlock(value as Record<string, Json>, output, depth, false);
}

export async function encodeYaml(value: Json, work: YqOwnedWork, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a nonnegative safe integer");
  const output = new Fragments(work, maxBytes);
  if (nonemptyCollection(value)) await block(value, output, 0);
  else await inline(value, output);
  work.assertOpen();
  return output.finish();
}

export async function encodeJson(value: Json, work: YqOwnedWork, pretty: boolean, maxBytes: number): Promise<string> {
  return work.stringifyJson(value, { pretty, maxBytes, limitName: "maxOutputBytes" });
}

export async function encodeRaw(text: string, work: YqOwnedWork, maxBytes: number): Promise<string> {
  if (!wellFormed(text)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
  let bytes = 0;
  let codePoints = 0;
  for (const character of text) {
    const incoming = Buffer.byteLength(character);
    if (incoming > maxBytes - bytes) throw new JqLimitError("maxOutputBytes");
    bytes += incoming;
    codePoints++;
    if (codePoints === 256) {
      await work.charge(codePoints);
      work.assertOpen();
      codePoints = 0;
    }
  }
  if (codePoints > 0) await work.charge(codePoints);
  work.assertOpen();
  if (bytes > 0) await work.charge(Math.ceil(bytes / 1024));
  work.assertOpen();
  return text;
}
