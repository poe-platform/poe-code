import { Emu, type Length } from "./length.js";

export interface OleApplication {
  readonly name: "DOCX" | "PPTX" | "XLSX";
  readonly value: "DOCX" | "PPTX" | "XLSX";
  readonly progId: string;
  readonly icon_filename: string;
  readonly width: Length;
  readonly height: Length;
}
export const PROG_ID = Object.freeze({
  DOCX: Object.freeze({
    name: "DOCX",
    value: "DOCX",
    progId: "Word.Document.12",
    icon_filename: "document-icon",
    width: new Emu(965200),
    height: new Emu(609600)
  }),
  PPTX: Object.freeze({
    name: "PPTX",
    value: "PPTX",
    progId: "PowerPoint.Show.12",
    icon_filename: "presentation-icon",
    width: new Emu(965200),
    height: new Emu(609600)
  }),
  XLSX: Object.freeze({
    name: "XLSX",
    value: "XLSX",
    progId: "Excel.Sheet.12",
    icon_filename: "spreadsheet-icon",
    width: new Emu(965200),
    height: new Emu(609600)
  })
} as const satisfies Readonly<Record<string, OleApplication>>);
export type PROG_ID = (typeof PROG_ID)[keyof typeof PROG_ID];
