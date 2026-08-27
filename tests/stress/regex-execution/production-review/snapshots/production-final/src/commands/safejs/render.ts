import { record } from "../../integrations/safejs/values.js";
import { SafeJsCommandLimitError } from "./types.js";

class Text {
  private readonly parts: string[] = [];
  private size = 0;
  private readonly active = new Set<object>();
  constructor(private readonly limit: number, private readonly fail: (error: unknown) => void) {}
  append(value: string): void {
    if (Buffer.byteLength(value) > this.limit - this.size) {
      const error = new SafeJsCommandLimitError("maxOutputBytes"); this.fail(error); throw error;
    }
    this.size += Buffer.byteLength(value);
    this.parts.push(value);
  }
  private quoted(value: string): void {
    if (Buffer.byteLength(value) + 2 > this.limit - this.size) {
      const error = new SafeJsCommandLimitError("maxOutputBytes"); this.fail(error); throw error;
    }
    this.append(JSON.stringify(value));
  }
  json(value: unknown, depth = 0): void {
    if (depth > 64) throw new TypeError("output JSON exceeds depth 64");
    if (value === null || value === undefined) { this.append("null"); return; }
    if (typeof value === "string") { this.quoted(value); return; }
    if (typeof value === "boolean" || typeof value === "number") { this.append(JSON.stringify(value)); return; }
    if (typeof value !== "object" || this.active.has(value)) throw new TypeError("output requires acyclic JSON data");
    this.active.add(value);
    try {
      if (Array.isArray(value)) {
        this.append("[");
        for (let index = 0; index < value.length; index++) {
          if (index) this.append(",");
          const property = Object.getOwnPropertyDescriptor(value, String(index));
          if (property && !("value" in property)) throw new TypeError("output arrays must contain data properties");
          this.json(property?.value, depth + 1);
        }
        this.append("]");
      } else {
        const entries = record(value, "output value");
        this.append("{");
        let first = true;
        for (const [key, item] of Object.entries(entries)) {
          if (item === undefined) continue;
          if (!first) this.append(","); first = false;
          this.quoted(key); this.append(":"); this.json(item, depth + 1);
        }
        this.append("}");
      }
    } finally { this.active.delete(value); }
  }
  finish(): string { return this.parts.join(""); }
}

export function renderOutput(values: readonly unknown[], limit: number, fail: (error: unknown) => void): string {
  const text = new Text(limit, fail);
  for (let index = 0; index < values.length; index++) {
    if (index) text.append(" ");
    const value = values[index];
    if (typeof value === "string") text.append(value);
    else if (value === undefined) text.append("undefined");
    else text.json(value);
  }
  text.append("\n");
  return text.finish();
}
