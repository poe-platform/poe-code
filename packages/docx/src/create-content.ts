import { tableBorders, tableGeometry, tableMargins, tableShading } from "./table-content.js";
import { InvalidValueError } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import type { DocxBlock, DocxContent, DocxLength, DocxRunInput, DocxThemeSettings } from "./operation-types.js";
import type { XmlElement } from "./package-xml.js";

export function xmlValue(value: string): string {
  let result = "";
  for (const char of value) {
    const n = char.codePointAt(0)!;
    if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff))
      throw new InvalidValueError("Invalid XML character in structured content.");
    result += ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\r": "&#13;", "\n": "&#10;", "\t": "&#9;" } as Record<string, string>)[char] ?? char;
  }
  return result;
}

function lengthEmu(value: DocxLength, positive = true): number {
  if (value.value < 0 || positive && value.value === 0) throw new InvalidValueError("Document length must be nonnegative or positive for this setting.");
  const scale = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700, twip: 635 }[value.unit];
  const emu = Math.round(value.value * scale);
  if (!Number.isSafeInteger(emu)) throw new InvalidValueError("Document length is outside the safe integer range.");
  if (Math.round(emu / 635) > 31680) throw new InvalidValueError("Document length is outside the supported page range.");
  return emu;
}

export function twips(value: DocxLength, positive = true): number {
  const result = Math.round(lengthEmu(value, positive) / 635);
  if (result < (positive ? 1 : 0))
    throw new InvalidValueError("Document length is outside the supported page range.");
  return result;
}

export function pageGeometry(page: DocxContent["page"], existing?: XmlElement, w?: string) {
  const attribute = (element: string, name: string): number | undefined => {
    const node = existing?.children.find(child => child.namespace === w && child.localName === element);
    const raw = node?.attributes.find(a => a.namespace === w && a.localName === name)?.value;
    return raw === undefined ? undefined : Number(raw);
  };
  const width = page?.width ? twips(page.width) : attribute("pgSz", "w") ?? 12240;
  const height = page?.height ? twips(page.height) : attribute("pgSz", "h") ?? 15840;
  const margins = Object.fromEntries(Object.entries({ top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720, gutter: 0 }).map(([key, fallback]) => {
    const value = page?.margins?.[key as keyof NonNullable<NonNullable<DocxContent["page"]>["margins"]>];
    return [key, value ? twips(value, false) : attribute("pgMar", key) ?? fallback];
  }));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Object.values(margins).some(v => !Number.isSafeInteger(v) || v < 0) ||
    width <= margins.left! + margins.right! + margins.gutter! || height <= margins.top! + margins.bottom!)
    throw new InvalidValueError("Page margins must leave positive content extent.");
  const xml = `<w:pgSz w:w="${width}" w:h="${height}"${page?.orientation ? ` w:orient="${page.orientation}"` : ""}/><w:pgMar ${Object.entries(margins).map(([key, value]) => `w:${key}="${value}"`).join(" ")}/><w:cols w:num="1"/>`;
  return { width: width - margins.left! - margins.right! - margins.gutter!, xml };
}

export function renderContent(content: DocxContent, w: string, budget: DocumentBudget, stylesRoot?: XmlElement, containerWidth = 9360) {
  const styles = new Map<string, { id: string; type: string; outline?: string | undefined; builtin?: boolean }>();
  const ids = new Set<string>();
  for (const style of stylesRoot?.children ?? []) {
    if (style.namespace !== w || style.localName !== "style") continue;
    const attribute = (node: XmlElement, key: string) => node.attributes.find(a => a.namespace === w && a.localName === key)?.value;
    const id = attribute(style, "styleId"), type = attribute(style, "type");
    const name = style.children.find(c => c.namespace === w && c.localName === "name");
    const value = name && attribute(name, "val");
    if (id) ids.add(id);
    if (value && id && type) {
      if (styles.has(value)) throw new InvalidValueError("Ambiguous style name in template.");
      const properties = style.children.find(child => child.namespace === w && child.localName === "pPr");
      const outline = properties?.children.find(child => child.namespace === w && child.localName === "outlineLvl");
      styles.set(value, { id, type, outline: outline ? attribute(outline, "val") : undefined, builtin: !["1", "true", "on"].includes(attribute(style, "customStyle") ?? "") });
    }
  }
  const added: string[] = [];
  const allocate = () => { let n = 1; while (ids.has(`Style${n}`)) n++; const id = `Style${n}`; ids.add(id); return id; };
  for (const style of content.styles ?? []) {
    if (styles.has(style.name)) throw new InvalidValueError("A declared style name already exists.");
    const id = allocate();
    styles.set(style.name, { id, type: style.type });
    const size = style.size === undefined ? undefined : Math.round(lengthEmu(style.size) / 6350);
    if (size !== undefined && size < 1) throw new InvalidValueError("Font size must round to a positive half-point value.");
    const formatting = (style.font === undefined ? "" : `<w:rFonts w:ascii="${xmlValue(style.font)}" w:hAnsi="${xmlValue(style.font)}"/>`) +
      (size === undefined ? "" : `<w:sz w:val="${size}"/>`) +
      (style.bold === undefined ? "" : `<w:b w:val="${Number(style.bold)}"/>`) + (style.italic === undefined ? "" : `<w:i w:val="${Number(style.italic)}"/>`);
    added.push(`<w:style xmlns:w="${w}" w:type="${style.type}" w:customStyle="1" w:styleId="${id}"><w:name w:val="${xmlValue(style.name)}"/>${formatting ? `<w:rPr>${formatting}</w:rPr>` : ""}</w:style>`);
  }
  const resolve = (name: string, type: string): string => {
    const style = styles.get(name);
    if (!style || style.type !== type) throw new InvalidValueError("Expected an existing style of the selected kind.");
    return style.id;
  };
  const headings = new Map<number, string>();
  const heading = (level: number) => {
    if (headings.has(level)) return headings.get(level)!;
    const name = level === 0 ? "Title" : `Heading ${level}`;
    const stem = level === 0 ? "Title" : `Heading${level}`;
    const found = [...styles.entries()].find(([label, style]) => {
      const suffix = style.id.slice(stem.length);
      const identity = style.id === stem || style.id.startsWith(stem) && suffix.length > 0 && [...suffix].every(c => c >= "0" && c <= "9");
      return identity && style.builtin && style.type === "paragraph" &&
        (label === name || label.startsWith(name + " ")) && (level === 0 || style.outline === String(level - 1));
    })?.[1];
    if (found) { headings.set(level, found.id); return found.id; }
    let id = stem;
    for (let n = 1; ids.has(id); n++) id = `${stem}${n}`;
    ids.add(id);
    let label = name;
    for (let n = 1; styles.has(label); n++) label = `${name} ${n}`;
    styles.set(label, { id, type: "paragraph", builtin: true, outline: level ? String(level - 1) : undefined });
    added.push(`<w:style xmlns:w="${w}" w:type="paragraph" w:customStyle="0" w:styleId="${id}"><w:name w:val="${label}"/><w:qFormat/>${level ? `<w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` : ""}</w:style>`);
    headings.set(level, id); return id;
  };
  const run = (input: DocxRunInput): string => {
    let formatting = input.style === undefined ? "" : `<w:rStyle w:val="${xmlValue(resolve(input.style, "character"))}"/>`;
    for (const [key, tag] of [["bold", "b"], ["italic", "i"]] as const) if (input[key] != null) formatting += `<w:${tag} w:val="${Number(input[key])}"/>`;
    if (input.underline != null) {
      const values = { NONE: "none", SINGLE: "single", WORDS: "words", DOUBLE: "double", DOTTED: "dotted", THICK: "thick", DASH: "dash", DOT_DASH: "dotDash", DOT_DOT_DASH: "dotDotDash", WAVY: "wave", DOTTED_HEAVY: "dottedHeavy", DASH_HEAVY: "dashedHeavy", DOT_DASH_HEAVY: "dashDotHeavy", DOT_DOT_DASH_HEAVY: "dashDotDotHeavy", WAVY_HEAVY: "wavyHeavy", DASH_LONG: "dashLong", WAVY_DOUBLE: "wavyDouble", DASH_LONG_HEAVY: "dashLongHeavy" };
      const value = typeof input.underline === "boolean" ? input.underline ? "single" : "none" : values[input.underline.name as keyof typeof values];
      formatting += `<w:u w:val="${value}"/>`;
    }
    let text = "", pending = "";
    const flush = () => { if (pending) { text += `<w:t xml:space="preserve">${xmlValue(pending)}</w:t>`; pending = ""; } };
    for (const char of input.text) {
      if (char === "\t" || char === "\n" || char === "\r") { flush(); text += char === "\t" ? "<w:tab/>" : "<w:br/>"; }
      else pending += char;
    }
    flush();
    return `<w:r>${formatting ? `<w:rPr>${formatting}</w:rPr>` : ""}${text}</w:r>`;
  };
  const blocks = (items: readonly DocxBlock[], width: number, depth: number): string => {
    budget.check("xmlDepth", depth);
    return items.map(block => {
      budget.charge("work", 1);
      if (block.kind === "paragraph") {
        const style = block.level !== undefined ? heading(block.level) : block.style === undefined ? undefined : resolve(block.style, "paragraph");
        const props = style ? `<w:pPr><w:pStyle w:val="${xmlValue(style)}"/></w:pPr>` : "";
        return `<w:p xmlns:w="${w}">${props}${block.runs ? block.runs.map(run).join("") : block.text === undefined ? "" : run({ text: block.text })}</w:p>`;
      }
      const rows = block.rows.length, columns = block.rows[0]!.length;
      budget.check("tableRows", rows); budget.check("tableColumns", columns); budget.charge("tableCells", rows * columns);
      const geometry = tableGeometry(block, width, w);
      const { widths } = geometry;
      const style = block.style !== undefined ? `<w:tblStyle w:val="${xmlValue(resolve(block.style, "table"))}"/>` : "";
      return `<w:tbl xmlns:w="${w}"><w:tblPr>${style}${geometry.properties}</w:tblPr><w:tblGrid>${widths.map(value => `<w:gridCol w:w="${value}"/>`).join("")}</w:tblGrid>${block.rows.map((row, rowIndex) => `<w:tr>${geometry.rows[rowIndex]}${row.map((cell, i) => {
        const innerWidth = widths[i]! - (cell.margins?.left ? twips(cell.margins.left, false) : geometry.margin) - (cell.margins?.right ? twips(cell.margins.right, false) : geometry.margin);
        if (innerWidth <= 0) throw new InvalidValueError("Cell margins must leave positive content width.");
        const properties = `<w:tcW w:w="${widths[i]}" w:type="dxa"/>` + tableBorders(cell.borders, "tcBorders", w) + tableShading(cell.shading) + tableMargins(cell.margins, "tcMar", w);
        return `<w:tc><w:tcPr>${properties}</w:tcPr>${blocks(cell.blocks, innerWidth, depth + 3)}${cell.blocks.at(-1)?.kind !== "paragraph" ? "<w:p/>" : ""}</w:tc>`;
      }).join("")}</w:tr>`).join("")}</w:tbl>`;
    }).join("");
  };
  const body = blocks(content.blocks, containerWidth, 3);
  budget.charge("retainedBytes", (body.length + added.join("").length) * 8);
  return { body, styles: added.join("") };
}

export function renderTheme(theme: DocxThemeSettings, a: string): string {
  const colors = { dark1: "000000", light1: "FFFFFF", dark2: "202020", light2: "F0F0F0", accent1: "305070", accent2: "507050", accent3: "705030", accent4: "604070", accent5: "307070", accent6: "706030", hyperlink: "0000FF", followedHyperlink: "800080", ...theme.colors };
  const tags = { dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6", hyperlink: "hlink", followedHyperlink: "folHlink" };
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `<a:theme xmlns:a="${a}" name="${xmlValue(theme.name)}"><a:themeElements><a:clrScheme name="${xmlValue(theme.name)}">${Object.entries(colors).map(([key, value]) => `<a:${tags[key as keyof typeof tags]}><a:srgbClr val="${value.toUpperCase()}"/></a:${tags[key as keyof typeof tags]}>`).join("")}</a:clrScheme><a:fontScheme name="${xmlValue(theme.name)}">${[["majorFont", theme.majorFont], ["minorFont", theme.minorFont]].map(([tag, font]) => `<a:${tag}><a:latin typeface="${xmlValue(font!)}"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`).join("")}</a:fontScheme><a:fmtScheme name="${xmlValue(theme.name)}"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="6350">${fill}<a:prstDash val="solid"/></a:ln>`.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}
