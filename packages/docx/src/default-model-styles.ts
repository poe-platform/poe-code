import { xmlValue } from "./create-content.js";

/** Original minimal definitions for the three default style-owner families. */
export function originalModelDefaults(namespace: string): string {
  return `<w:docDefaults xmlns:w="${namespace}"/>` + [
    ["paragraph", "Normal", "Normal"],
    ["character", "DefaultParagraphFont", "Default Paragraph Font"],
    ["table", "NormalTable", "Normal Table"]
  ].map(([type, id, name]) => `<w:style xmlns:w="${namespace}" w:type="${type}" w:default="1" w:styleId="${id}"><w:name w:val="${xmlValue(name!)}"/></w:style>`).join("");
}
