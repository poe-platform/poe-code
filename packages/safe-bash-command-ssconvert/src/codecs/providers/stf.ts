import type { FormatProvider } from "../types.js";
import { probeText, probeTextName, readText, readTextAssistant } from "../text.js";
import { writeConfigurableText, writePlainCsv } from "../text-export.js";

export default {
  "id": "Gnumeric_stf",
  source: "src/stf.c",
  services: [
    { id: "stf_csvtab", direction: "read", description: "Comma or tab separated values (CSV/TSV)", extensions: ["csv", "tsv", "txt"], mimeTypes: ["application/tab-separated-values", "text/comma-separated-values", "text/csv", "text/x-csv", "text/spreadsheet", "text/tab-separated-values"], probePriority: 0, contentProbe: true, encodingDependent: true, probeName: probeTextName, probeContent: probeText, read: readText },
    { id: "stf_assistant", direction: "read", description: "Text import (configurable)", extensions: [], mimeTypes: ["text/plain", "text/csv", "text/x-csv", "text/comma-separated-values", "text/tab-separated-values"], probePriority: 0, encodingDependent: true, interactiveOnly: true, read: readTextAssistant },
    { id: "stf_assistant", direction: "write", description: "Text (configurable)", extensions: ["txt"], byteStrings: "utf8-text", sheetSelection: true, honorsExportRange: true, write: writeConfigurableText,
      exportOptionRules: {
        eol: { kind: "enum", values: ["unix", "mac", "windows"], asciiCaseInsensitive: true,
          error: "eol must be one of unix, mac, and windows" },
        charset: { kind: "string" }, locale: { kind: "string" }, quote: { kind: "string" }, separator: { kind: "string" },
        format: { kind: "enum", values: ["automatic", "raw", "preserve", "GNM_STF_FORMAT_AUTO", "GNM_STF_FORMAT_RAW", "GNM_STF_FORMAT_PRESERVE"] },
        "transliterate-mode": { kind: "enum", values: ["transliterate", "escape", "GNM_STF_TRANSLITERATE_MODE_TRANS", "GNM_STF_TRANSLITERATE_MODE_ESCAPE"] },
        "quoting-mode": { kind: "enum", values: ["never", "auto", "always", "GSF_OUTPUT_CSV_QUOTING_MODE_NEVER", "GSF_OUTPUT_CSV_QUOTING_MODE_AUTO", "GSF_OUTPUT_CSV_QUOTING_MODE_ALWAYS"] },
        "quoting-on-whitespace": { kind: "boolean" }
      }, source: "src/stf-export.c:774" },
    { id: "stf_csv", direction: "write", description: "Comma separated values (CSV)", extensions: ["csv"], byteStrings: "utf8-text", formatLevel: "manual_remember", saveScope: "sheet", sheetSelection: true, honorsExportRange: true, write: writePlainCsv }
  ]
} satisfies FormatProvider;
