import type { FormatProvider } from "../types.js";
import { probeQpro, readQpro } from "../qpro.js";

export default {
  "id": "Gnumeric_QPro",
  "services": [
    {
      "id": "qpro",
      "direction": "read",
      probeContent: probeQpro,
      read: readQpro,
      "description": "Quattro Pro (*.wb1, *.wb2, *.wb3)",
      "extensions": [
        "wb1",
        "wb2",
        "wb3"
      ],
      "mimeTypes": [
        "application/x-quattropro",
        "application/x-quattro-pro"
      ],
      "probePriority": 100,
      "contentProbe": true
    }
  ],
  "source": "plugins/qpro/plugin.xml.in"
} satisfies FormatProvider;
