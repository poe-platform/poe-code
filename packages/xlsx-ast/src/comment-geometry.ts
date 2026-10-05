import type { MetadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";

interface CommentGeometry {
  readonly style: Readonly<Record<string, string>>;
  readonly anchor: string;
  readonly flags: readonly { name: string; text: string }[];
}

/** Retain only scalar geometry for uniquely identified VML notes, never shape relationships or executable markup. */
export function readCommentGeometry(roots: readonly (MetadataNode | undefined)[], charge: (amount?: number) => void): ReadonlyMap<string, CommentGeometry | undefined> {
  const result = new Map<string, CommentGeometry | undefined>();
  const vml = "urn:schemas-microsoft-com:vml", excel = "urn:schemas-microsoft-com:office:excel";
  for (const root of roots) for (const shape of root?.children ?? []) {
    charge();
    if (shape.name !== "shape" || shape.namespace !== vml) continue;
    const data = shape.children.find(n => { charge(); return n.name === "ClientData" && n.namespace === excel && n.attributes.ObjectType === "Note"; });
    if (!data) continue;
    const fields = new Map<string, MetadataNode>(); let duplicate = false;
    for (const field of data.children) {
      charge(); if (field.namespace !== excel) continue;
      duplicate ||= fields.has(field.name); fields.set(field.name, field);
    }
    const rowText = fields.get("Row")?.text.trim(), columnText = fields.get("Column")?.text.trim();
    if (!rowText || !columnText) continue;
    const row = Number(rowText), column = Number(columnText);
    if (!Number.isInteger(row) || row < 0 || row >= 1048576 || !Number.isInteger(column) || column < 0 || column >= 16384) continue;
    const key = `${row}:${column}`;
    if (result.has(key)) { result.set(key, undefined); continue; }
    // An invalid or duplicate source cannot lend its geometry to another note.
    result.set(key, undefined);
    const anchor = fields.get("Anchor")?.text, coordinates = anchor?.split(",").map(s => s.trim());
    if (duplicate || !coordinates || coordinates.length !== 8 || coordinates.some(s => !s || !Number.isSafeInteger(Number(s)) || Number(s) < 0)) continue;
    if ([0, 4].some(i => Number(coordinates[i]) >= 16384) || [2, 6].some(i => Number(coordinates[i]) >= 1048576)) continue;
    const style: Record<string, string> = {};
    for (const declaration of (shape.attributes.style ?? "").split(";")) {
      charge(); const colon = declaration.indexOf(":"); if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim().toLowerCase();
      if (["margin-left", "margin-top", "width", "height"].includes(name)) {
        const unit = ["pt", "px", "in", "cm", "mm", "pc"].find(u => value.endsWith(u));
        const scalar = unit ? value.slice(0, -unit.length).trim() : value;
        const number = Number(scalar);
        if (scalar && Number.isFinite(number) && (unit || number === 0) && (!["width", "height"].includes(name) || number >= 0)) style[name] = `${number}${unit ?? ""}`;
      } else if (name === "visibility" && ["visible", "hidden"].includes(value)) style[name] = value;
      else if (name === "z-index" && value && Number.isSafeInteger(Number(value))) style[name] = value;
    }
    const flags = [];
    for (const name of ["MoveWithCells", "SizeWithCells", "Visible", "AutoFill"]) {
      const field = fields.get(name); if (!field) continue;
      const text = field.text.trim();
      if (["", "true", "false", "t", "f", "1", "0"].includes(text.toLowerCase())) flags.push({ name, text });
    }
    result.set(key, { style, anchor: coordinates.join(", "), flags });
  }
  return result;
}
