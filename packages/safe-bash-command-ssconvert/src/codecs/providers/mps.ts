import type { FormatProvider } from "../types.js";


export default {
  "id": "Gnumeric_mps",
  "services": [
    {
      "id": "mps",
      "direction": "read",
      read: async (bytes, context) => (await import("../mps.js")).readMps(bytes, context),
      "description": "Linear and integer program (*.mps) file format",
      "extensions": [
        "mps"
      ],
      "mimeTypes": [
        "application/x-mps"
      ],
      "probePriority": 1
    }
  ],
  "source": "plugins/mps/plugin.xml.in"
} satisfies FormatProvider;
