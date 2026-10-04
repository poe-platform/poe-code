import type {Range} from "../workbook.js";
import type {XmlElement, XmlAttribute} from "@poe-code/safe-fs/xml";

/** XML v3-v5 applies only specified style fields, including individual font fields. */
export function applyGnumericStyle(previous: XmlElement, patch: XmlElement, tick: () => void): XmlElement {
  const attributes = new Map<string, XmlAttribute>();
  for (const attribute of [...previous.attributes, ...patch.attributes]) {
    tick();
    attributes.set(JSON.stringify([attribute.namespace, attribute.localName]), attribute);
  }
  const children = new Map<string, XmlElement>();
  for (const child of previous.children) {
    tick();
    children.set(JSON.stringify([child.namespace, child.localName]), child);
  }
  for (const child of patch.children) {
    tick();
    if (patch.localName === "StyleBorder" && child.namespace === patch.namespace) {
      const style = child.attributes.find(attribute => {tick(); return attribute.namespace === "" && attribute.localName === "Style";});
      // Native ignores a side without a nonnegative border style, including color-only patches.
      if (!style || style.value.trim() === "" || !Number.isInteger(Number(style.value)) || Number(style.value) < 0) continue;
    }
    const key = JSON.stringify([child.namespace, child.localName]), prior = children.get(key);
    // Borders are independent sides; each side replaces its complete border.
    // Other complex style fields (validation, hyperlinks, conditions) replace as a unit.
    children.set(key, prior && child.namespace === patch.namespace &&
      (child.localName === "Font" || child.localName === "StyleBorder")
      ? applyGnumericStyle(prior, child, tick) : child);
  }
  const text = patch.localName === "Font" && patch.text === "" ? previous.text : patch.text;
  return {...patch, attributes: [...attributes.values()], children: [...children.values()], text,
    content: [...(text ? [{kind: "text" as const, text}] : []), ...children.values()]};
}

/** Normalize legacy aliases before applying native style replacement or merging. */
export function normalizeGnumericStyle(style: XmlElement, tick: () => void): XmlElement {
  const attributes = new Map<string, XmlAttribute>();
  for (const original of style.attributes) {
    tick();
    let attribute = original;
    if (attribute.namespace === "" && (attribute.localName === "Fit" || attribute.localName === "WrapText")) {
      // Native strtol accepts leading ASCII whitespace and signed decimal integers.
      // It reads a long, then assigns to int before treating the result as boolean.
      const value = attribute.value;
      let at = 0, amount = 0n;
      while (at < value.length && " \t\n\r\v\f".includes(value[at]!)) {tick(); at++;}
      const negative = value[at] === "-";
      if (negative || value[at] === "+") at++;
      const start = at, limit = negative ? 9223372036854775808n : 9223372036854775807n;
      while (at < value.length && value[at]! >= "0" && value[at]! <= "9") {
        tick();
        amount = amount * 10n + BigInt(value.charCodeAt(at++) - 48);
        if (amount > limit) break;
      }
      if (at === value.length && amount <= limit && (at > start || value === "")) {
        attribute = {...attribute, name: "WrapText", localName: "WrapText",
          value: BigInt.asIntN(32, negative ? -amount : amount) === 0n ? "0" : "1"};
      }
    }
    attributes.set(JSON.stringify([attribute.namespace, attribute.localName]), attribute);
  }
  const children = style.children.map(font => {
    tick();
    if (font.localName !== "Font" || font.namespace !== style.namespace || !font.text.startsWith("-")) return font;
    const offset = (component: number) => {
      let at = 0, separators = 0;
      while (at < font.text.length && separators < component) {
        tick();
        if (font.text[at++] === "-") separators++;
      }
      if (font.text[at] === "-") {tick(); at++;}
      return at;
    };
    const hints = new Set<string>();
    if (font.text.startsWith("bold", offset(2))) hints.add("Bold");
    const slant = offset(3);
    if (font.text.startsWith("i", slant) || font.text.startsWith("o", slant)) hints.add("Italic");
    const attributes = font.attributes.filter(attribute => {
      tick();
      return attribute.namespace !== "" || !hints.has(attribute.localName);
    });
    for (const name of hints) attributes.push({name, localName: name, namespace: "", value: "1"});
    return {...font, text: "", attributes, content: font.children};
  });
  return {...style, attributes: [...attributes.values()], children, content: [...(style.text ? [{kind: "text" as const, text: style.text}] : []), ...children]};
}

/** Resolve legacy partial overlays without enumerating cells in styled ranges. */
export function resolveGnumericStyleRegions(regions: readonly {region: XmlElement; style: XmlElement | undefined; bounds: Range}[], tick: () => void): XmlElement[] {
  type Region = {region: XmlElement; style: XmlElement; bounds: Range};
  let resolved: Region[] = [];
  const intersection = (a: Range, b: Range): Range | undefined => {
    tick();
    const bounds = {startRow: Math.max(a.startRow, b.startRow), endRow: Math.min(a.endRow, b.endRow),
      startColumn: Math.max(a.startColumn, b.startColumn), endColumn: Math.min(a.endColumn, b.endColumn)};
    return bounds.startRow <= bounds.endRow && bounds.startColumn <= bounds.endColumn ? bounds : undefined;
  };
  const outside = (a: Range, cut: Range): Range[] => {
    const parts: Range[] = [];
    if (a.startRow < cut.startRow) parts.push({...a, endRow: cut.startRow - 1});
    if (a.endRow > cut.endRow) parts.push({...a, startRow: cut.endRow + 1});
    if (a.startColumn < cut.startColumn) parts.push({...a, startRow: cut.startRow, endRow: cut.endRow, endColumn: cut.startColumn - 1});
    if (a.endColumn > cut.endColumn) parts.push({...a, startRow: cut.startRow, endRow: cut.endRow, startColumn: cut.endColumn + 1});
    return parts;
  };
  for (const patch of regions) {
    tick();
    if (!patch.style) continue;
    const next: Region[] = [];
    let uncovered = [patch.bounds];
    for (const prior of resolved) {
      const overlap = intersection(prior.bounds, patch.bounds);
      if (!overlap) {next.push(prior); continue;}
      for (const bounds of outside(prior.bounds, overlap)) {tick(); next.push({...prior, bounds});}
      next.push({...patch, style: applyGnumericStyle(prior.style, patch.style, tick), bounds: overlap});
      uncovered = uncovered.flatMap(bounds => {
        const cut = intersection(bounds, overlap);
        return cut ? outside(bounds, cut) : [bounds];
      });
    }
    for (const bounds of uncovered) {tick(); next.push({...patch, style: patch.style, bounds});}
    resolved = next;
  }
  return resolved.map(({region, style, bounds}) => {
    tick();
    const attributes = Object.entries({startRow: bounds.startRow, endRow: bounds.endRow,
      startCol: bounds.startColumn, endCol: bounds.endColumn})
      .map(([name, value]) => ({name, localName: name, namespace: "", value: String(value)}));
    return {...region, attributes, children: [style], text: "", content: [style]};
  });
}
