import type { FormatProvider } from "../types.js";
import { probeLotus, readLotus } from "../lotus.js";

export default {
  "id": "Gnumeric_lotus",
  "services": [
    {
      "id": "lotus",
      "direction": "read",
      probeContent: probeLotus,
      read: readLotus,
      "description": "Lotus 123 (*.wk1, *.wks, *.123)",
      "extensions": [
        "wk1",
        "wk4",
        "wr1",
        "wks",
        "123"
      ],
      "mimeTypes": [
        "application/vnd.lotus-1-2-3",
        "application/x-123"
      ],
      "contentProbe": true
    }
  ],
  "source": "plugins/lotus-123/plugin.xml.in"
} satisfies FormatProvider;
