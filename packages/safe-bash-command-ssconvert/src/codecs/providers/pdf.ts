import { writePdf, pdfExportOptions } from "../pdf.js";
import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_pdf",
  source: "src/print-info.c:1074",
  services: [
    { id: "pdf_assistant", direction: "write", description: "PDF export", extensions: ["pdf"], sheetSelection: true, honorsExportRange: false, write: writePdf, exportOptions: pdfExportOptions,
      exportOptionRules: { object: { kind: "string" }, paper: { kind: "string" } } }
  ]
} satisfies FormatProvider;
