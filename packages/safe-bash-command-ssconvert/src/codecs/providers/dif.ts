import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_dif",
  "services": [
    {
      "id": "dif",
      "direction": "read",
      read: async (bytes, context) => (await import("../dif.js")).readDif(bytes, context),
      "description": "Data Interchange Format (*.dif)",
      "extensions": [
        "dif"
      ],
      "probePriority": 1
    },
    {
      "id": "dif",
      "direction": "write",
      write: async (book, options, context) => (await import("../dif.js")).writeDif(book, options, context),
      "description": "Data Interchange Format (*.dif)",
      "extensions": [
        "dif"
      ],
      "formatLevel": "manual_remember",
      "saveScope": "sheet",
      "selectionSource": "view"
    }
  ],
  "source": "plugins/dif/plugin.xml.in"
} satisfies FormatProvider;
