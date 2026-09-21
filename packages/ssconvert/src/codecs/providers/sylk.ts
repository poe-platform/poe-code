import type { FormatProvider } from "../types.js";
import { probeSylk, readSylk, writeSylk } from "../sylk.js";

export default {
  "id": "Gnumeric_sylk",
  "services": [
    {
      "id": "sylk",
      "direction": "read",
      probeContent: probeSylk,
      read: readSylk,
      "description": "MultiPlan (SYLK)",
      "extensions": [
        "slk",
        "sylk"
      ],
      "mimeTypes": [
        "application/x-sylk"
      ],
      "probePriority": 1,
      "contentProbe": true
    },
    {
      "id": "sylk",
      "direction": "write",
      write: writeSylk,
      "description": "MultiPlan (SYLK)",
      "extensions": [
        "slk"
      ],
      "mimeTypes": [
        "application/x-sylk"
      ],
      "formatLevel": "auto",
      "saveScope": "sheet",
      "selectionSource": "view"
    }
  ],
  "source": "plugins/sylk/plugin.xml.in"
} satisfies FormatProvider;
