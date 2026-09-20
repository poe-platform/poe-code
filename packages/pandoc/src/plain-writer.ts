import type { Block, Caption, Inline } from "./ast-types.js";
import type { AdapterContext, Document, SerializedDocument } from "./types.js";
import { PandocError } from "./errors.js";

class Plain {
  constructor(readonly context: AdapterContext) {}
  join(parts: readonly string[], separator = ""): string {
    const length = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1) * separator.length;
    this.context.checkpoint(length + 1);
    this.context.bound("outputBytes", length);
    this.context.charge("retainedBytes", length * 2);
    this.context.charge("references", parts.length);
    return parts.join(separator);
  }
  fail(path: string, message: string): never {
    throw new PandocError("E_CAPABILITY", this.context.operation ?? "write", message, "plain", path);
  }
  raw(source: string, path: string): string {
    if(!this.context.rawContent || this.context.rawContent === "reject") this.fail(path, "Plain cannot interpret raw content; use an explicit rawContent source policy");
    this.context.report({code: "W_RAW_CONTENT", operation: this.context.operation ?? "write", format: "plain", location: path, message: "Raw source retained verbatim; its meaning is unsupported"});
    return source || " ";
  }
  async inline(nodes: readonly Inline[], path: string): Promise<string> {
    const parts: string[] = [];
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate();
      const p = `${path}[${i}]`;
      switch(node.t) {
        case "Str": parts.push(node.c); break;
        case "Space": parts.push(" "); break;
        case "SoftBreak": case "LineBreak": parts.push("\n"); break;
        case "Code": parts.push(node.c[1]); break;
        case "Math": this.fail(p, "Plain cannot preserve math meaning"); break;
        case "Cite": this.fail(p, "Plain cannot resolve citation meaning"); break;
        case "RawInline": parts.push(this.raw(node.c[1], p)); break;
        case "Quoted": {const quote = node.c[0] === "DoubleQuote" ? '"' : "'"; parts.push(this.join([quote, await this.inline(node.c[1], `${p}.c[1]`), quote])); break;}
        case "Link": case "Image": {
          const label = await this.inline(node.c[1], `${p}.c[1]`), [url, title] = node.c[2];
          const value = node.t === "Image" ? label || " " : label ? label === url || !url ? label : this.join([label, " (", url, ")"]) : url || " ";
          parts.push(title ? this.join([value, ' "', title, '"']) : value); break;
        }
        case "Note": parts.push(this.join(["[note: ", await this.blocks(node.c, `${p}.c`), "]"])); break;
        case "Span": parts.push(await this.inline(node.c[1], `${p}.c[1]`)); break;
        default: parts.push(await this.inline(node.c, `${p}.c`));
      }
    }
    return this.join(parts);
  }
  indent(text: string, first: string, rest: string): string {
    // Charge before split/map allocate; retain whitespace on code lines.
    this.context.charge("retainedBytes", (text.length + (text.length + 1) * Math.max(first.length, rest.length)) * 2);
    return this.join(text.split("\n").map((line, i) => line ? (i ? rest : first) + line : ""), "\n");
  }
  async caption(caption: Caption, path: string): Promise<string> {
    return this.join([caption[0] ? await this.inline(caption[0], `${path}[0]`) : "", await this.blocks(caption[1], `${path}[1]`)].filter(Boolean), "\n\n");
  }
  async blocks(nodes: readonly Block[], path: string): Promise<string> {
    const parts: string[] = [];
    let previous: Block["t"] | undefined;
    for(const [i, node] of nodes.entries()) {
      await this.context.cooperate();
      const p = `${path}[${i}]`;
      let value = "";
      switch(node.t) {
        case "Plain": case "Para": value = await this.inline(node.c, `${p}.c`); break;
        case "Header": value = await this.inline(node.c[2], `${p}.c[2]`); break;
        case "HorizontalRule": value = "---"; break;
        case "CodeBlock": if(node.c[1]) value = this.indent(node.c[1], "    ", "    "); break;
        case "RawBlock": value = this.raw(node.c[1], p); break;
        case "LineBlock": {const lines: string[] = []; for(const [j, line] of node.c.entries()) lines.push(await this.inline(line, `${p}.c[${j}]`)); value = this.join(lines, "\n"); break;}
        case "BlockQuote": {const content = await this.blocks(node.c, `${p}.c`); if(content) value = this.indent(content, "  ", "  "); break;}
        case "Div": value = await this.blocks(node.c[1], `${p}.c[1]`); break;
        case "Figure": value = this.join([await this.blocks(node.c[2], `${p}.c[2]`), await this.caption(node.c[1], `${p}.c[1]`)].filter(Boolean), "\n\n"); break;
        case "BulletList": case "OrderedList": {
          const items = node.t === "BulletList" ? node.c : node.c[1];
          const rendered: string[] = [];
          for(const [j, item] of items.entries()) {
            const marker = node.t === "BulletList" ? "-" : `${node.c[0][0] + j}.`;
            const content = await this.blocks(item, `${p}.c${node.t === "OrderedList" ? "[1]" : ""}[${j}]`);
            rendered.push(content ? this.indent(content, marker + " ", " ".repeat(marker.length + 1)) : marker);
          }
          value = this.join(rendered, "\n"); break;
        }
        case "DefinitionList": {
          const entries: string[] = [];
          for(const [j, [term, definitions]] of node.c.entries()) {
            const content = [await this.inline(term, `${p}.c[${j}][0]`)];
            for(const [k, definition] of definitions.entries()) content.push(this.indent(await this.blocks(definition, `${p}.c[${j}][1][${k}]`), "  ", "  "));
            entries.push(this.join(content, "\n"));
          }
          value = this.join(entries, "\n\n"); break;
        }
        case "Table": {
          const rows: string[] = [];
          const sections = [[node.c[3][1], `${p}.c[3][1]`] as const, ...node.c[4].flatMap((body, j) => [[body[2], `${p}.c[4][${j}][2]`] as const, [body[3], `${p}.c[4][${j}][3]`] as const]), [node.c[5][1], `${p}.c[5][1]`] as const];
          for(const [section, path] of sections) for(const [j, row] of section.entries()) {
            const cells: string[] = [];
            for(const [k, cell] of row[1].entries()) {
              const cp = `${path}[${j}][1][${k}]`;
              if(cell[2] !== 1 || cell[3] !== 1) {
                if(!this.context.lossy) this.fail(cp, "Flattened cell span");
                this.context.report({code: "W_TABLE_LOSS", operation: this.context.operation ?? "write", format: "plain", location: cp, message: "Flattened cell span"});
              }
              cells.push(await this.blocks(cell[4], `${cp}[4]`));
            }
            rows.push(this.join(cells, "\t"));
          }
          const caption = await this.caption(node.c[1], `${p}.c[1]`);
          value = this.join([...(caption ? [caption] : []), this.join(rows, "\n")], caption ? "\n" : ""); break;
        }
      }
      if(value) {if(parts.length) parts.push(previous === "Plain" ? "\n" : "\n\n"); parts.push(value); previous = node.t;}
    }
    return this.join(parts);
  }
}
export async function writePlain(document: Document, context: AdapterContext): Promise<SerializedDocument> {
  const out = new Plain(context);
  const text = await out.blocks(document.blocks, "$.blocks");
  return {kind: "text", text: text ? out.join([text, "\n"]) : ""};
}
