import type { FormatProvider } from "../types.js";
import { readApplix, probeApplix } from "../applix.js";

export default {
  "id": "Gnumeric_applix",
  "services": [
    {
      "id": "applix",
      "direction": "read",
      read: readApplix,
      probeContent: probeApplix,
      "description": "Applix (*.as)",
      "extensions": [
        "as"
      ],
      "mimeTypes": [
        "application/x-applix-spreadsheet"
      ],
      "probePriority": 100,
      "contentProbe": true
    }
  ],
  "source": "plugins/applix/plugin.xml.in"
} satisfies FormatProvider;
