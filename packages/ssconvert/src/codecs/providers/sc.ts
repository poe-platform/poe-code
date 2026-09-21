import type { FormatProvider } from "../types.js";
import { readSc, probeSc } from "../sc.js";

export default {
  "id": "Gnumeric_sc",
  "services": [
    {
      "id": "sc",
      "direction": "read",
      read: readSc,
      probeContent: probeSc,
      "description": "SC/xspread",
      "extensions": [],
      "mimeTypes": [
        "application/x-sc"
      ],
      "probePriority": 51,
      "contentProbe": true
    }
  ],
  "source": "plugins/sc/plugin.xml.in"
} satisfies FormatProvider;
