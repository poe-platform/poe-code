import type { Attr, Block, Inline } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import type { FormatSelection } from "./formats.js";
import { PandocError } from "./errors.js";
import { writeGfm } from "./table-writers.js";

/** Reserve worst-case expansion before constructing each intermediate string. */
class Markdown {
  readonly targets = new Map<string, {count: number; id: string; target: readonly [string, string]}>();
  constructor(readonly context: AdapterContext, readonly selection: FormatSelection) {}
  reserve(length: number): void {
    this.context.checkpoint(length + 1);
    this.context.bound("outputBytes", length);
    this.context.charge("retainedBytes", length * 2);
  }
  join(parts: readonly string[], separator = ""): string {
    this.reserve(parts.reduce((n, part) => n + part.length, 0) + Math.max(0, parts.length - 1) * separator.length);
    return parts.join(separator);
  }
  loss(path: string, feature: string): void {
    if(!this.context.lossy) throw new PandocError("E_UNSUPPORTED_FEATURE", this.context.operation ?? "write", `Markdown cannot represent ${feature}`, this.selection.descriptor.name, path);
    this.context.report({code: "W_RAW_CONTENT", operation: this.context.operation ?? "write", format: this.selection.descriptor.name, location: path, message: `Projected ${feature}`});
  }
  attrs(attr: Attr, path: string): void {
    if(attr[0] || attr[1].length || attr[2].length) this.loss(path, "attributes");
  }
  escape(text: string, target = false): string {
    this.reserve(text.length * 6);
    let result = "";
    for(const ch of text) {
      if(ch === "\r") continue;
      if(target) result += ch === "\n" ? "&#10;" : ch === " " ? "&#32;" : "\\<>\"&".includes(ch) ? `\\${ch}` : ch;
      else result += ch === "\n" ? "&#10;" : ch === "\t" ? "&#9;" : ch === " " ? "&#32;" : "\\`*_{}[]<>|!#~&:".includes(ch) ? `\\${ch}` : ch;
    }
    return result;
  }
  text(text: string, boundaryStart: boolean, boundaryEnd: boolean, digitsBefore = false): string {
    this.reserve(text.length * 6);
    let leading = 0, trailing = text.length;
    if(boundaryStart) while(text[leading] === " ") leading++;
    if(boundaryEnd) while(trailing > leading && text[trailing - 1] === " ") trailing--;
    let result = "";
    for(let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if(ch === " " && i >= leading && i < trailing) result += ch;
      else if(this.selection.extensions.autolink_bare_uris && (ch === "@" || ch === "." && text.slice(Math.max(0, i - 3), i).toLowerCase() === "www")) result += `\\${ch}`;
      else if("-+.)".includes(ch)) result += (boundaryStart && i === 0 && ch !== ")" || (ch === "." || ch === ")") && (digitsBefore || boundaryStart && i > 0) && [...text.slice(0, i)].every(c => c >= "0" && c <= "9")) ? `\\${ch}` : ch;
      else result += this.escape(ch);
    }
    return result;
  }
  run(text: string, char: string): number {
    let max = 0, run = 0;
    for(const ch of text) {this.context.checkpoint(); run = ch === char ? run + 1 : 0; max = Math.max(max, run);}
    return max;
  }
  inline(nodes: readonly Inline[], path: string, marker = "", task = false, cell = false): string {
    const parts: string[] = [];
    let previousMarker = "";
    let digitsBefore = false;
    for(const [i, node] of nodes.entries()) {
      this.context.checkpoint();
      const p = `${path}[${i}]`;
      if(node.t !== "Str") digitsBefore = false;
      switch(node.t) {
        case "Str": {
          let value = node.c;
          if(cell && [...value].some(ch => "\r\n\t".includes(ch))) {
            if(!this.context.lossy) throw new PandocError("E_UNSUPPORTED_FEATURE", this.context.operation ?? "write", "Flattened cell text line boundaries", "gfm", p);
            this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: "gfm", location: p, message: "Flattened cell text line boundaries"});
            this.reserve(value.length); value = value.split("\n").join(" ").split("\r").join(" ").split("\t").join(" ");
          }
          parts.push(this.text(value, i === 0 || nodes[i - 1]?.t === "SoftBreak" || nodes[i - 1]?.t === "LineBreak", i === nodes.length - 1 || nodes[i + 1]?.t === "SoftBreak" || nodes[i + 1]?.t === "LineBreak", digitsBefore));
          digitsBefore = (i === 0 || digitsBefore) && value.length > 0 && [...value].every(ch => ch >= "0" && ch <= "9"); break;}
        case "Space": parts.push(i === 0 || i === nodes.length - 1 ? "&#32;" : " "); break;
        case "SoftBreak": parts.push("\n"); break;
        case "LineBreak": parts.push("\\\n"); break;
        case "Emph": case "Strong": case "Strikeout": {
          if(node.t === "Strikeout" && !this.selection.extensions.strikeout) {this.loss(p, "strikeout"); parts.push(this.inline(node.c, `${p}.c`)); break;}
          const touchingText = nodes[i - 1]?.t === "Str" || nodes[i + 1]?.t === "Str";
          const char = node.t === "Strikeout" ? "~" : nodes[i - 1]?.t === node.t ? previousMarker === "*" ? "_" : "*" : marker === "*" && !touchingText ? "_" : "*";
          previousMarker = char;
          const delimiter = char.repeat(node.t === "Emph" ? 1 : 2);
          parts.push(this.join([delimiter, this.inline(node.c, `${p}.c`, char, false, cell), delimiter])); break;
        }
        case "Code": {
          this.attrs(node.c[0], p);
          if(node.c[1].includes("\n") || node.c[1].includes("\r")) this.loss(p, "code-span line boundaries");
          this.reserve(node.c[1].length * 2);
          let value = node.c[1].split("\r\n").join(" ").split("\r").join(" ").split("\n").join(" ");
          if(cell) {this.reserve(value.length * 2); value = value.split("|").join("\\|");}
          const size = this.run(value, "`") + 1;
          this.reserve(value.length + size * 2 + 2);
          const delimiter = "`".repeat(size);
          const padding = value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") && value.endsWith(" ") && [...value].some(ch => ch !== " ") ? " " : "";
          parts.push(this.join([delimiter, padding, value, padding, delimiter])); break;
        }
        case "Link": case "Image": {
          this.attrs(node.c[0], p);
          const label = this.inline(node.c[1], `${p}.c[1]`);
          const url = this.escape(node.c[2][0], true);
          const title = node.c[2][1] ? this.join([' "', this.escape(node.c[2][1], true), '"']) : "";
          const reference = this.targets.get(JSON.stringify(node.c[2]));
          parts.push(reference && reference.count > 1 ? this.join([node.t === "Image" ? "![" : "[", label, "][", reference.id, "]"]) : this.join([node.t === "Image" ? "![" : "[", label, "](<", url, ">", title, ")"])); break;
        }
        case "Span": {
          const attr = node.c[0];
          if(task && i === 0 && attr[0] === "" && attr[1].length === 1 && attr[1][0] === "task-list-marker" && attr[2].length === 1 && attr[2][0]?.[0] === "checked" && ["true", "false"].includes(attr[2][0][1]) && node.c[1].length === 0) {
            if(!this.selection.extensions.task_lists) {this.loss(p, "task state"); break;}
            parts.push(attr[2][0][1] === "true" ? "[x] " : "[ ] ");
          } else {this.attrs(attr, p); parts.push(this.inline(node.c[1], `${p}.c[1]`));} break;
        }
        case "Quoted": {const quote = node.c[0] === "DoubleQuote" ? '"' : "'"; parts.push(this.join([quote, this.inline(node.c[1], `${p}.c[1]`), quote])); break;}
        case "Cite": this.loss(p, "citations"); parts.push(this.inline(node.c[1], `${p}.c[1]`)); break;
        case "RawInline": this.loss(p, "raw inline content"); parts.push(this.text(node.c[1], true, true)); break;
        case "Math": this.loss(p, "math"); parts.push(this.text(node.c[1], true, true)); break;
        case "Note": this.loss(p, "notes"); break;
        default: this.loss(p, node.t); parts.push(this.inline(node.c, `${p}.c`));
      }
    }
    return this.join(parts);
  }
  indent(text: string, first: string, rest: string): string {
    let lines = 1;
    for(const ch of text) if(ch === "\n") lines++;
    this.reserve(text.length + first.length + (lines - 1) * rest.length);
    return text.split("\n").map((line, i) => i === 0 ? first + line : line ? rest + line : rest.trimEnd()).join("\n");
  }
  async blocks(nodes: readonly Block[], path: string, task = false): Promise<string> {
    const parts: string[] = [];
    let previousBullet = "";
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate();
      const p = `${path}[${i}]`;
      if(i) parts.push(nodes[i - 1]?.t === "Plain" ? "\n" : "\n\n");
      switch(node.t) {
        case "Plain": case "Para": parts.push(this.inline(node.c, `${p}.c`, "", task && i === 0)); break;
        case "Header": this.attrs(node.c[1], p); parts.push(this.join(["#".repeat(node.c[0]), " ", this.inline(node.c[2], `${p}.c[2]`)])); break;
        case "HorizontalRule": parts.push("---"); break;
        case "CodeBlock": {
          const attr = node.c[0];
          if(attr[0] || attr[1].length > 1 || attr[2].length) this.loss(p, "code block attributes");
          const info = attr[1][0] ?? "";
          if([...info].some(ch => "\r\n` ".includes(ch))) this.loss(p, "code language");
          this.reserve(node.c[1].length * 2);
          const value = node.c[1].split("\r\n").join("\n").split("\r").join("\n");
          const size = Math.max(3, this.run(value, "`") + 1);
          this.reserve(value.length + size * 2 + info.length + 2);
          const fence = "`".repeat(size);
          parts.push(this.join([fence, info, "\n", value, value.endsWith("\n") ? "" : "\n", fence])); break;
        }
        case "BlockQuote": parts.push(this.indent(await this.blocks(node.c, `${p}.c`), "> ", "> ")); break;
        case "BulletList": case "OrderedList": {
          if(node.t === "OrderedList" && (!["Decimal", "DefaultStyle"].includes(node.c[0][1]) || !["Period", "DefaultDelim", "OneParen"].includes(node.c[0][2]))) this.loss(p, "list numbering style");
          const items = node.t === "BulletList" ? node.c : node.c[1];
          const loose = items.some(item => item.some(block => block.t === "Para"));
          const rendered: string[] = [];
          for(const [j, item] of items.entries()) {
            const mark = node.t === "BulletList" ? nodes[i - 1]?.t === "BulletList" && previousBullet === "-" ? "+" : "-" : `${node.c[0][0] + j}${node.c[0][2] === "OneParen" ? ")" : "."}`;
            this.reserve(mark.length + 1);
            const content = await this.blocks(item, `${p}.items[${j}]`, true);
            rendered.push(content ? this.indent(content, mark + " ", " ".repeat(mark.length + 1)) : mark);
          }
          if(node.t === "BulletList") previousBullet = nodes[i - 1]?.t === "BulletList" && previousBullet === "-" ? "+" : "-";
          parts.push(this.join(rendered, loose ? "\n\n" : "\n")); break;
        }
        case "Table": {
          if(!this.selection.extensions.pipe_tables) throw new PandocError("E_UNSUPPORTED_FEATURE", this.context.operation ?? "write", "Pipe tables are unavailable", this.selection.descriptor.name, p);
          const result = await writeGfm({blocks: [node], metadata: {}, resources: []}, this.context, this.selection, (nodes, path) => this.inline(nodes, path, "", false, true));
          if(result.kind === "text") parts.push(result.text.endsWith("\n") ? result.text.slice(0, -1) : result.text); break;
        }
        case "Div": this.attrs(node.c[0], p); parts.push(await this.blocks(node.c[1], `${p}.c[1]`)); break;
        case "RawBlock": this.loss(p, "raw blocks"); parts.push(this.text(node.c[1], true, true)); break;
        default: this.loss(p, node.t);
      }
    }
    return this.join(parts);
  }
}
export async function writeMarkdown(document: Document, context: AdapterContext, selection?: FormatSelection): Promise<SerializedDocument> {
  if(!selection) throw new PandocError("E_INTERNAL", context.operation ?? "write", "Markdown requires format selection");
  const out = new Markdown(context, selection);
  const visit = async (value: unknown): Promise<void> => {
    await context.cooperate();
    if(!value || typeof value !== "object") return;
    if("t" in value && (value.t === "Link" || value.t === "Image")) {
      const target = (value as Extract<Inline, {t: "Link" | "Image"}>).c[2];
      out.reserve((target[0].length + target[1].length) * 6 + 8);
      const key = JSON.stringify(target);
      const entry = out.targets.get(key);
      if(entry) entry.count++;
      else {context.charge("references", 1); out.reserve(key.length); out.targets.set(key, {count: 1, id: String(out.targets.size + 1), target});}
    }
    for(const child of Object.values(value)) await visit(child);
  };
  await visit(document.blocks);
  let text = await out.blocks(document.blocks, "$.blocks");
  const definitions: string[] = [];
  for(const entry of out.targets.values()) if(entry.count > 1) definitions.push(out.join(["[", entry.id, "]: <", out.escape(entry.target[0], true), ">", entry.target[1] ? out.join([' "', out.escape(entry.target[1], true), '"']) : ""]));
  if(definitions.length) text = out.join([text, "\n\n", out.join(definitions, "\n")]);
  return {kind: "text", text: text && !text.endsWith("\n") ? out.join([text, "\n"]) : text};
}
