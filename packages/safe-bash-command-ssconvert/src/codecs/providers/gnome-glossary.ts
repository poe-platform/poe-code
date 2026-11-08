import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_GnomeGlossary",
  "services": [
    {
      "id": "po",
      write: async (book, options, context) => (await import("../glossary.js")).writeGlossary(book, options, context),
      "direction": "write",
      "description": "Gnome Glossary PO file format",
      "extensions": [
        "po"
      ]
    }
  ],
  "source": "plugins/gnome-glossary/plugin.xml.in"
} satisfies FormatProvider;
