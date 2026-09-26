import type { FormatProvider } from "../types.js";

import { writeModelProgram } from '../model-program.js';

export default {
  "id": "Gnumeric_lpsolve",
  "services": [
    {
      "id": "lpsolve",
      "direction": "write",
      write: (book, _options, context) => writeModelProgram(book, context, 'lpsolve'),
      "description": "LPSolve Linear Program Solver",
      "extensions": [
        "lp"
      ],
      "mimeTypes": [
        "application/lpsolve"
      ],
      "saveScope": "sheet"
    }
  ],
  "source": "plugins/lpsolve/plugin.xml.in"
} satisfies FormatProvider;
