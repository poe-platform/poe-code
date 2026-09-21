import type { FormatProvider } from "../types.js";
import { readParadox, writeParadox } from "../paradox.js";

export default {
  "id": "Gnumeric_paradox",
  "services": [
    {
      "id": "paradox",
      "direction": "read",
      read: readParadox,
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
      write: writeParadox,
      "description": "Paradox database (*.db)",
      "extensions": [
        "db"
      ]
    }
  ],
  "source": "plugins/paradox/plugin.xml.in"
} satisfies FormatProvider;
