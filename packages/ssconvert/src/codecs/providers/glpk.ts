import type { FormatProvider } from "../types.js";

import { writeModelProgram } from '../model-program.js';

export default {
  "id": "Gnumeric_glpk",
  "services": [
    {
      "id": "glpk",
      "direction": "write",
      write: (book, _options, context) => writeModelProgram(book, context, 'glpk'),
      "description": "GLPK Linear Program Solver",
      "extensions": [
        "cplex"
      ],
      "mimeTypes": [
        "application/glpk"
      ],
      "saveScope": "sheet"
    }
  ],
  "source": "plugins/glpk/plugin.xml.in"
} satisfies FormatProvider;
