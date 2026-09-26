import type { FormatProvider } from "../types.js";
import { readDif, writeDif } from "../dif.js";

export default {
  "id": "Gnumeric_dif",
  "services": [
    {
      "id": "dif",
      "direction": "read",
      read: readDif,
      "description": "Data Interchange Format (*.dif)",
      "extensions": [
        "dif"
      ],
      "probePriority": 1
    },
    {
      "id": "dif",
      "direction": "write",
      write: writeDif,
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
