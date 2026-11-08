import type { Attributes } from "./dot.js";
/** Relative advance widths for the default Times-like font; CJK and emoji use an em. */
export function textWidth(text: string, size: number, font = "Times-Roman"): number {
  let width = 0;
  const mono = font.toLowerCase().includes("mono") || font.toLowerCase().includes("courier");
  const sans = font.toLowerCase().includes("arial") || font.toLowerCase().includes("helvetica");
  for (const c of text) {
    let advance = 0.5;
    if (mono) advance = 0.6;
    else if (" ilI.,'!:;|".includes(c)) advance = 0.278;
    else if ("mwMW@%&".includes(c)) advance = c === "W" || c === "M" ? 0.944 : 0.778;
    else if (c >= "A" && c <= "Z") advance = 0.667;
    else if (c.codePointAt(0)! >= 0x2e80) advance = 1;
    else if ("frt()[]".includes(c)) advance = 0.333;
    else if (sans) advance = 0.556;
    width += advance * size;
  }
  return width;
}
export function numeric(value: string | undefined, fallback: number, min = 0): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n >= min
    ? n
    : fallback;
}
export function pair(value: string | undefined, fallback: number): [number, number] {
  const parts = value?.split(",");
  const x = numeric(parts?.[0], fallback);
  return [x, numeric(parts?.[1], x)];
}
export function labelLines(label: string, id = ""): string[] {
  if (label.startsWith("<") && label.endsWith(">")) {
    let text = "";
    let i = 1;
    while (i < label.length - 1) {
      if (label[i] === "<") {
        const end = label.indexOf(">", i + 1);
        if (end < 0) break;
        const tag = label
          .slice(i + 1, end)
          .toLowerCase()
          .trim();
        if (tag.startsWith("br") || tag === "/tr") text += "\n";
        else if (tag === "/td") text += " ";
        i = end + 1;
      } else text += label[i++]!;
    }
    return decodeEntities(text).trim().split("\n");
  }
  return label
    .split("\\N")
    .join(id)
    .split("\\n")
    .join("\n")
    .split("\\l")
    .join("\n")
    .split("\\r")
    .join("\n")
    .split("\n");
}
export function decodeEntities(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "&") {
      result += text[i];
      continue;
    }
    const end = text.indexOf(";", i + 1);
    if (end < 0) {
      result += "&";
      continue;
    }
    const name = text.slice(i + 1, end);
    const known: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " "
    };
    let value = known[name];
    if (name.startsWith("#")) {
      const n = name.startsWith("#x") ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (Number.isInteger(n) && n > 0 && n <= 0x10ffff) value = String.fromCodePoint(n);
    }
    if (value === undefined) result += "&";
    else {
      result += value;
      i = end;
    }
  }
  return result;
}
export interface RecordField {
  label: string;
  port?: string;
  children?: RecordField[];
}
export function recordFields(label: string): RecordField[] {
  let i = 0;
  const parse = (): RecordField[] => {
    const fields: RecordField[] = [];
    let text = "";
    let port: string | undefined;
    const flush = () => {
      fields.push({ label: text.trim(), ...(port !== undefined ? { port } : {}) });
      text = "";
      port = undefined;
    };
    while (i < label.length) {
      const c = label[i++]!;
      if (c === "\\" && i < label.length) text += label[i++]!;
      else if (c === "{") {
        if (text || port) flush();
        fields.push({ label: "", children: parse() });
      } else if (c === "}") {
        if (text || port || !fields.length) flush();
        return fields;
      } else if (c === "|") {
        if (text || port || !fields.length) flush();
      } else if (c === "<") {
        const end = label.indexOf(">", i);
        if (end >= 0) {
          port = label.slice(i, end);
          i = end + 1;
        } else text += c;
      } else text += c;
    }
    if (text || port || !fields.length) flush();
    return fields;
  };
  return parse();
}
export function nodeSize(id: string, attributes: Attributes): [number, number] {
  const size = numeric(attributes.fontsize, 14, 1);
  const shape = attributes.shape ?? "ellipse";
  let lines = labelLines(attributes.label ?? id, id);
  if (shape === "record" || shape === "Mrecord") {
    const flatten = (fields: RecordField[]): string[] =>
      fields.flatMap((field) => (field.children ? flatten(field.children) : [field.label]));
    lines = [flatten(recordFields(attributes.label ?? id)).join("   ")];
  }
  const [mx, my] = pair(attributes.margin, 0.11);
  let width =
    Math.max(...lines.map((line) => textWidth(line, size, attributes.fontname)), 0) + mx * 144;
  let height = lines.length * size * 1.2 + my * 144;
  if (shape === "ellipse" || shape === "oval" || shape === "diamond") {
    width *= Math.SQRT2;
    height *= Math.SQRT2;
  }
  width = Math.max(
    width,
    numeric(attributes.width, shape === "plaintext" || shape === "none" ? 0 : 0.75) * 72
  );
  height = Math.max(
    height,
    numeric(attributes.height, shape === "plaintext" || shape === "none" ? 0 : 0.5) * 72
  );
  if (attributes.fixedsize === "true") {
    width = numeric(attributes.width, 0.75) * 72;
    height = numeric(attributes.height, 0.5) * 72;
  }
  if (shape === "circle" || shape === "doublecircle") width = height = Math.max(width, height);
  return [Math.max(1, width), Math.max(1, height)];
}
