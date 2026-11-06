import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosString, dictSet } from "@poe-code/pdf-ast";
import { createPdfinfoCommand, runPdfinfoCli } from "./index.js";

for (const flag of ["-struct", "-struct-text"]) {
  for (const retained of [false, true]) {
    for (const fixture of ["tagged", "roles", "empty"] as const) {
      it(`${flag} formats ${fixture} structure with native roots and categories (retained=${retained})`, async () => {
        let bytes: Uint8Array;
        let stdout = "";
        if (fixture === "tagged") {
          bytes = await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue17069.pdf", import.meta.url));
          stdout = "Sect\n  P (block)\n" + (flag === "-struct-text" ? '    "Test doc"\n' : "");
        } else {
          const doc = PdfDocument.create(); doc.addPage();
          const root = doc.cos.resolveDict(doc.cos.rootRef)!;
          dictSet(root, "StructTreeRoot", cosDict({
            Type: cosName("StructTreeRoot"),
            RoleMap: cosDict({ Heading: cosName("H1"), Emphasis: cosName("Span") }),
            K: cosArray(fixture === "empty" ? [] : [cosDict({ S: cosName("Sect"), K: cosArray([
              cosDict({ S: cosName("Heading"), ActualText: cosString("Heading text") }),
              cosDict({ S: cosName("Emphasis") }),
              cosDict({ S: cosName("Table"), K: cosDict({ S: cosName("TR") }) }),
              cosDict({ S: cosName("Figure") }),
            ]) }), cosDict({ S: cosName("P") })]),
          }));
          bytes = doc.save();
          if (fixture === "roles") stdout = "Sect\n  Heading / H1 (block)\n" +
            (flag === "-struct-text" ? '    "Heading text"\n' : "") +
            "  Emphasis / Span (inline)\n  Table (block)\n    TR\n  Figure\nP (block)\n";
        }
        const expected = { exitCode: 0, stdout, stderr: "" };
        if (!retained) {
          const result = await runPdfinfoCli([flag, "in.pdf"], new Map([["in.pdf", bytes]]));
          // Text whitespace is independent of structure indentation and role labels.
          assert.deepEqual({ ...result, stdout: result.stdout.replace('"Test doc "', '"Test doc"') }, expected);
          return;
        }
        const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
        let output = "", stderr = "";
        const result = await createPdfinfoCommand().execute({
          command: "pdfinfo", args: [flag, "in.pdf"], cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        assert.deepEqual({ ...result, stdout: output.replace('"Test doc "', '"Test doc"'), stderr }, expected);
      });
    }
  }
}
