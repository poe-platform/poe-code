import type { Block, Inline, Row, Alignment } from "./ast-types.js";
import type { FormatDescriptor } from "./formats.js";
import type { ReaderCapability, WriterCapability } from "./types.js";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function textToInlines(text: string): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/( +)/);
  for (const part of parts) {
    if (!part) continue;
    if (part[0] === " ") out.push({ t: "Space" });
    else out.push({ t: "Str", c: part });
  }
  return out;
}

function parseMediawikiInlines(raw: string): Inline[] {
  const result: Inline[] = [];
  const tokenRe = /\[\[File:([^|\]]+)(?:\|([^\]]*))?\]\]|\[\[([^|\]]+)(?:\|([^\]]*))?\]\]|\[((?:https?:\/\/|mailto:)[^\s\]]+)(?:\s+([^\]]+))?\]|'''([\s\S]+?)'''|''([\s\S]+?)''|<code>([\s\S]*?)<\/code>|<s>([\s\S]*?)<\/s>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      result.push(...textToInlines(raw.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      const src = match[1].trim();
      const alt = (match[2] ?? "").split("|").pop()?.trim() ?? "";
      result.push({ t: "Image", c: [["", [], []], textToInlines(alt), [src, ""]] });
    } else if (match[3] !== undefined) {
      const target = match[3].trim();
      const label = (match[4] ?? target).trim();
      result.push({ t: "Link", c: [["", [], []], parseMediawikiInlines(label), [target, ""]] });
    } else if (match[5] !== undefined) {
      const url = match[5].trim();
      const label = (match[6] ?? url).trim();
      result.push({ t: "Link", c: [["", [], []], parseMediawikiInlines(label), [url, ""]] });
    } else if (match[7] !== undefined) {
      result.push({ t: "Strong", c: parseMediawikiInlines(match[7]) });
    } else if (match[8] !== undefined) {
      result.push({ t: "Emph", c: parseMediawikiInlines(match[8]) });
    } else if (match[9] !== undefined) {
      result.push({ t: "Code", c: [["", [], []], match[9]] });
    } else if (match[10] !== undefined) {
      result.push({ t: "Strikeout", c: parseMediawikiInlines(match[10]) });
    }
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < raw.length) {
    result.push(...textToInlines(raw.slice(lastIndex)));
  }
  return result;
}

export const readMediawiki: ReaderCapability["read"] = async (input, context) => {
  const text = input.text ?? await context.decodeUtf8([input.bytes]);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    await context.cooperate();
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    const headingMatch = /^(=+)\s*(.+?)\s*\1\s*$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1]!.length);
      const headingText = headingMatch[2]!;
      blocks.push({ t: "Header", c: [level, [slugify(headingText), [], []], parseMediawikiInlines(headingText)] });
      i++;
      continue;
    }
    if (/^-{4,}\s*$/.test(trimmed)) {
      blocks.push({ t: "HorizontalRule" });
      i++;
      continue;
    }
    if (trimmed.startsWith("<pre") || trimmed.startsWith("<syntaxhighlight")) {
      const langMatch = /lang=["']([^"']+)["']/.exec(trimmed);
      const lang = langMatch?.[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("</pre>") && !lines[i]!.trim().startsWith("</syntaxhighlight>")) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ t: "CodeBlock", c: [["", lang ? [lang] : [], []], codeLines.join("\n")] });
      continue;
    }
    if (trimmed.startsWith("{|")) {
      const headerRows: Row[] = [];
      const bodyRows: Row[] = [];
      let currentCells: string[] = [];
      let currentIsHeader = false;
      const flushRow = () => {
        if (!currentCells.length) return;
        const row: Row = [["", [], []], currentCells.map(cell => [["", [], []], "AlignDefault" as Alignment, 1, 1, [{ t: "Plain", c: parseMediawikiInlines(cell.trim()) }]])];
        if (currentIsHeader && !bodyRows.length) headerRows.push(row);
        else bodyRows.push(row);
        currentCells = [];
        currentIsHeader = false;
      };
      i++;
      while (i < lines.length) {
        const tline = lines[i]!.trim();
        i++;
        if (tline.startsWith("|}")) { flushRow(); break; }
        if (tline.startsWith("|-")) { flushRow(); continue; }
        if (tline.startsWith("|+")) continue;
        if (tline.startsWith("!")) {
          currentIsHeader = true;
          const parts = tline.slice(1).split("!!");
          for (const p of parts) currentCells.push(p.includes("|") && !p.includes("[[") ? p.slice(p.indexOf("|") + 1) : p);
        } else if (tline.startsWith("|")) {
          const parts = tline.slice(1).split("||");
          for (const p of parts) currentCells.push(p.includes("|") && !p.includes("[[") ? p.slice(p.indexOf("|") + 1) : p);
        }
      }
      const colCount = Math.max(1, ...[...headerRows, ...bodyRows].map(r => r[1].length));
      const colspecs = Array.from({ length: colCount }, () => ["AlignDefault" as Alignment, { t: "ColWidthDefault" as const }] as const);
      blocks.push({ t: "Table", c: [["", [], []], [null, []], colspecs, [["", [], []], headerRows], [[["", [], []], 0, [], bodyRows]], [["", [], []], []]] });
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("#")) {
      const marker = trimmed[0]!;
      const items: Block[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(marker)) {
        const itemText = lines[i]!.trim().replace(/^[*#]+\s*/, "");
        items.push([{ t: "Plain", c: parseMediawikiInlines(itemText) }]);
        i++;
      }
      if (marker === "*") blocks.push({ t: "BulletList", c: items });
      else blocks.push({ t: "OrderedList", c: [[1, "Decimal", "Period"], items] });
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i]!.trim();
      if (!cur || /^(=+).*\1$/.test(cur) || cur.startsWith("{|") || cur.startsWith("*") || cur.startsWith("#") || /^-{4,}$/.test(cur)) break;
      paraLines.push(cur);
      i++;
    }
    blocks.push({ t: "Para", c: parseMediawikiInlines(paraLines.join(" ")) });
  }
  return { blocks, metadata: {}, resources: [] };
};

function renderMediawikiInlines(inlines: readonly Inline[]): string {
  return inlines.map(node => {
    switch (node.t) {
      case "Str": return node.c;
      case "Space":
      case "SoftBreak": return " ";
      case "LineBreak": return "<br />\n";
      case "Strong": return "'''" + renderMediawikiInlines(node.c) + "'''";
      case "Emph": return "''" + renderMediawikiInlines(node.c) + "''";
      case "Strikeout": return "<s>" + renderMediawikiInlines(node.c) + "</s>";
      case "Superscript": return "<sup>" + renderMediawikiInlines(node.c) + "</sup>";
      case "Subscript": return "<sub>" + renderMediawikiInlines(node.c) + "</sub>";
      case "Underline": return "<u>" + renderMediawikiInlines(node.c) + "</u>";
      case "Code": return "<code>" + node.c[1] + "</code>";
      case "Math": return "<math>" + node.c[1] + "</math>";
      case "Quoted": return (node.c[0] === "SingleQuote" ? "'" : "\"") + renderMediawikiInlines(node.c[1]) + (node.c[0] === "SingleQuote" ? "'" : "\"");
      case "Cite": return renderMediawikiInlines(node.c[1]);
      case "Span": return renderMediawikiInlines(node.c[1]);
      case "Link": {
        const url = node.c[2][0];
        const label = renderMediawikiInlines(node.c[1]);
        if (/^(?:https?:\/\/|mailto:)/.test(url)) return label && label !== url ? `[${url} ${label}]` : `[${url}]`;
        return label && label !== url ? `[[${url}|${label}]]` : `[[${url}]]`;
      }
      case "Image": {
        const src = node.c[2][0];
        const alt = renderMediawikiInlines(node.c[1]);
        return alt ? `[[File:${src}|${alt}]]` : `[[File:${src}]]`;
      }
      case "RawInline": return node.c[1];
      case "Note": return "<ref>" + renderMediawikiBlocks(node.c).trim() + "</ref>";
      default: return "";
    }
  }).join("");
}

function renderMediawikiBlocks(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.t) {
      case "Header": {
        const eq = "=".repeat(Math.max(1, Math.min(6, block.c[0])));
        out.push(`${eq} ${renderMediawikiInlines(block.c[2])} ${eq}`);
        break;
      }
      case "Para":
      case "Plain":
        out.push(renderMediawikiInlines(block.c));
        break;
      case "CodeBlock": {
        const lang = block.c[0][1][0];
        out.push(lang ? `<syntaxhighlight lang="${lang}">\n${block.c[1]}\n</syntaxhighlight>` : `<pre>\n${block.c[1]}\n</pre>`);
        break;
      }
      case "BulletList":
        out.push(block.c.map(item => `* ${renderMediawikiBlocks(item).trim()}`).join("\n"));
        break;
      case "OrderedList":
        out.push(block.c[1].map(item => `# ${renderMediawikiBlocks(item).trim()}`).join("\n"));
        break;
      case "BlockQuote":
        out.push(`<blockquote>\n${renderMediawikiBlocks(block.c).trim()}\n</blockquote>`);
        break;
      case "HorizontalRule":
        out.push("----");
        break;
      case "Div":
        out.push(renderMediawikiBlocks(block.c[1]).trim());
        break;
      case "RawBlock":
        out.push(block.c[1]);
        break;
      case "Table": {
        const lines: string[] = ["{| class=\"wikitable\""];
        for (const row of block.c[3][1]) {
          lines.push("|-");
          lines.push("! " + row[1].map(cell => renderMediawikiBlocks(cell[4]).trim()).join(" !! "));
        }
        for (const body of block.c[4]) {
          for (const row of [...body[2], ...body[3]]) {
            lines.push("|-");
            lines.push("| " + row[1].map(cell => renderMediawikiBlocks(cell[4]).trim()).join(" || "));
          }
        }
        lines.push("|}");
        out.push(lines.join("\n"));
        break;
      }
    }
  }
  return out.filter(Boolean).join("\n\n") + "\n";
}

export const writeMediawiki: WriterCapability["write"] = async (document) => {
  return { kind: "text", text: renderMediawikiBlocks(document.blocks) };
};

export const mediawikiDescriptor: FormatDescriptor = Object.freeze({
  name: "mediawiki",
  operands: "join",
  reader: { format: "mediawiki", read: readMediawiki },
  writer: { format: "mediawiki", write: writeMediawiki },
  read: true,
  write: true,
  media: "text",
  inputEncoding: "utf8",
  suffixes: ["mediawiki", "wiki"],
  extensions: {},
  options: {
    read: [],
    write: ["wrap", "columns", "standalone", "metadata", "toc", "ascii", "eol", "rawContent"]
  }
});
