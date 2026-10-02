import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_oleo",
  "services": [
    {
      "id": "oleo",
      "direction": "read",
      read: async (bytes, context) => (await import("../oleo.js")).readOleo(bytes, context),
      "description": "GNU Oleo (*.oleo)",
      "extensions": [
        "oleo"
      ],
      "mimeTypes": [
        "application/x-oleo"
      ],
      "probePriority": 100
    }
  ],
  "source": "plugins/oleo/plugin.xml.in"
} satisfies FormatProvider;
