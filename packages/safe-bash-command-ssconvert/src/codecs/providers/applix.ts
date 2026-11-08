import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_applix",
  "services": [
    {
      "id": "applix",
      "direction": "read",
      read: async (bytes, context) => (await import("../applix.js")).readApplix(bytes, context),
      probeContent: async (bytes, context) => (await import("../applix.js")).probeApplix(bytes, context),
      "description": "Applix (*.as)",
      "extensions": [
        "as"
      ],
      "mimeTypes": [
        "application/x-applix-spreadsheet"
      ],
      "probePriority": 100,
      "contentProbe": true
    }
  ],
  "source": "plugins/applix/plugin.xml.in"
} satisfies FormatProvider;
