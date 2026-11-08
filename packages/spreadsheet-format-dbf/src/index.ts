import type { FormatProvider } from "@poe-code/spreadsheet-engine/codecs/types";

export const dbfFormat: FormatProvider = {
  "id": "Gnumeric_xbase",
  "services": [
    {
      "id": "xbase",
      "direction": "read",
      read: async (bytes, context) => (await import("./xbase.js")).readXbase(bytes, context),
      "description": "Xbase (*.dbf) file format",
      "extensions": [
        "dbf"
      ],
      "mimeTypes": [
        "application/dbase",
        "application/dbf",
        "application/x-dbase",
        "application/x-dbf",
        "application/x-xbase",
        "zz-application/zz-winassoc-dbf"
      ],
      "probePriority": 100
    }
  ],
  "source": "plugins/xbase/plugin.xml.in"
};
