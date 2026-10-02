import type { FormatProvider } from "../types.js";


export default {
  "id": "Gnumeric_glpk",
  "services": [
    {
      "id": "glpk",
      "direction": "write",
      write: async (book, _options, context) => (await import("../model-program.js")).writeModelProgram(book, context, "glpk"),
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
