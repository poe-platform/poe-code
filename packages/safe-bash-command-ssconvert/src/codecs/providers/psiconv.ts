import type { FormatProvider } from "../types.js";
import { probePsion, readPsion } from "../psion.js";

export default {
  "id": "Gnumeric_psiconv",
  "services": [
    {
      "id": "psiconv",
      "direction": "read",
      probeContent: probePsion,
      read: readPsion,
      "description": "Psion (*.psisheet)",
      "extensions": [
        "psisheet"
      ],
      "probePriority": 100,
      "contentProbe": true
    }
  ],
  "source": "plugins/psiconv/plugin.xml.in"
} satisfies FormatProvider;
