import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_sylk",
  "services": [
    {
      "id": "sylk",
      "direction": "read",
      probeContent: async (bytes, context) => (await import("../sylk.js")).probeSylk(bytes, context),
      read: async (bytes, context) => (await import("../sylk.js")).readSylk(bytes, context),
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
      write: async (book, options, context) => (await import("../sylk.js")).writeSylk(book, options, context),
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
