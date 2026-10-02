import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

for (const dialect of ["transitional", "strict"] as const) {
  for (const kind of ["docx", "dotx"] as const) {
    for (const operation of ["run-format", "style-edit"] as const) {
      for (const value of [null, undefined]) {
        for (const acquisition of ["valid", "malformed"] as const) {
          it(`rejects ${operation} options ${String(value)} before ${acquisition} acquisition; ${dialect}; ${kind}`, async () => {
            const archive = await docx.createDocumentArchive({ kind, dialect,
              content: { version: 1, blocks: [{ kind: "paragraph", text: "Coast" }] }
            }, textContext);
            const volume = Volume.fromJSON({ "/input": "", "/destination": "Retained destination" });
            await docx.writeArchive(archive, {
              async write(bytes) { volume.appendFileSync("/input", bytes); }
            }, { order: "input", compression: "store" }, textContext);
            const input = acquisition === "valid"
              ? new Uint8Array(volume.readFileSync("/input") as Buffer)
              : new Uint8Array([255]);
            volume.writeFileSync("/input", input);
            const context = { ...textContext, encoding: { order: "input", compression: "store" } as const,
              stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/destination", bytes); } }
            };
            const error = await (operation === "run-format"
              ? docx.formatDocumentRuns(input, value as unknown as Parameters<typeof docx.formatDocumentRuns>[1], context)
              : docx.editDocumentStyles(input, value as unknown as Parameters<typeof docx.editDocumentStyles>[1], context)
            ).catch((failure: unknown) => failure);
            expect(error).toMatchObject({ code: "usage" });
            expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
            expect(volume.readFileSync("/destination", "utf8")).toBe("Retained destination");
          });
        }
      }
      it(`rejects ${operation} accessor options without invocation; ${dialect}; ${kind}`, async () => {
        const volume = Volume.fromJSON({ "/input": Buffer.from([255]), "/destination": "Retained destination" });
        const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
        let calls = 0;
        const options = Object.defineProperty({}, operation === "run-format" ? "bold" : "operation", {
          enumerable: true, get() { calls++; throw new Error("Accessor must remain inert."); }
        });
        const context = { ...textContext, encoding: { order: "input", compression: "store" } as const,
          stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/destination", bytes); } }
        };
        const error = await (operation === "run-format"
          ? docx.formatDocumentRuns(input, options as Parameters<typeof docx.formatDocumentRuns>[1], context)
          : docx.editDocumentStyles(input, options as Parameters<typeof docx.editDocumentStyles>[1], context)
        ).catch((failure: unknown) => failure);
        expect(calls).toBe(0);
        expect(error).toMatchObject({ code: "usage" });
        expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
        expect(volume.readFileSync("/destination", "utf8")).toBe("Retained destination");
      });
    }
  }
}
