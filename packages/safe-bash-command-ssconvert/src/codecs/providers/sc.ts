import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_sc",
  "services": [
    {
      "id": "sc",
      "direction": "read",
      read: async (bytes, context) => (await import("../sc.js")).readSc(bytes, context),
      probeContent: async (bytes, context) => (await import("../sc.js")).probeSc(bytes, context),
      "description": "SC/xspread",
      "extensions": [],
      "mimeTypes": [
        "application/x-sc"
      ],
      "probePriority": 51,
      "contentProbe": true
    }
  ],
  "source": "plugins/sc/plugin.xml.in"
} satisfies FormatProvider;
