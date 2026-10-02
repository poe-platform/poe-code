import type { FormatProvider } from "../types.js";

export default {
  "id": "Gnumeric_psiconv",
  "services": [
    {
      "id": "psiconv",
      "direction": "read",
      probeContent: async (bytes, context) => (await import("../psion.js")).probePsion(bytes, context),
      read: async (bytes, context) => (await import("../psion.js")).readPsion(bytes, context),
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
