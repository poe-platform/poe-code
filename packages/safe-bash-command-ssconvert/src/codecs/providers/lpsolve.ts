import type { FormatProvider } from "../types.js";


export default {
  "id": "Gnumeric_lpsolve",
  "services": [
    {
      "id": "lpsolve",
      "direction": "write",
      write: async (book, _options, context) => (await import("../model-program.js")).writeModelProgram(book, context, "lpsolve"),
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
