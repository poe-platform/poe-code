import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_paradox",
  "services": [
    {
      "id": "paradox",
      "direction": "read",
      read: async (bytes, context) => (await import("../paradox.js")).readParadox(bytes, context),
      "description": "Paradox database or primary index file (*.db, *.px)",
      "extensions": [
        "db",
        "px"
      ],
      "probePriority": 100
    },
    {
      "id": "paradox",
      "direction": "write",
      write: async (book, options, context) => (await import("../paradox.js")).writeParadox(book, options, context),
      exportOptionRules: { encryption: { kind: "enum", values: ["paradox"] } },
      "description": "Paradox database (*.db)",
      "extensions": [
        "db"
      ]
    }
  ],
  "source": "plugins/paradox/plugin.xml.in"
} satisfies FormatProvider;
