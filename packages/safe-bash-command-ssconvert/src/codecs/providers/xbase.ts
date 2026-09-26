import type { FormatProvider } from "../types.js";
import { readXbase } from "../xbase.js";

export default {
  "id": "Gnumeric_xbase",
  "services": [
    {
      "id": "xbase",
      "direction": "read",
      read: readXbase,
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
} satisfies FormatProvider;
