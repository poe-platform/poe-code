import type { FormatProvider } from "../types.js";
import { readOleo } from "../oleo.js";

export default {
  "id": "Gnumeric_oleo",
  "services": [
    {
      "id": "oleo",
      "direction": "read",
      read: readOleo,
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
