import { writeGlossary } from "../glossary.js";
import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_GnomeGlossary",
  "services": [
    {
      "id": "po",
      write: writeGlossary,
      "direction": "write",
      "description": "Gnome Glossary PO file format",
      "extensions": [
        "po"
      ]
    }
  ],
  "source": "plugins/gnome-glossary/plugin.xml.in"
} satisfies FormatProvider;
