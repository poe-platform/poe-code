import type { FormatProvider } from "../types.js";
import { probePln, readPln } from "../pln.js";

export default {
  "id": "Gnumeric_plan_perfect",
  "services": [
    {
      "id": "pln",
      "direction": "read",
      probeContent: probePln,
      read: readPln,
      "description": "Plan Perfect Format (PLN) import",
      "extensions": [
        "pln"
      ],
      "mimeTypes": [
        "application/x-planperfect"
      ],
      "probePriority": 1,
      "contentProbe": true
    }
  ],
  "source": "plugins/plan-perfect/plugin.xml.in"
} satisfies FormatProvider;
