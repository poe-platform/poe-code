import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, readXlsx, type Diagnostic } from "./index.js";

// Source-qualified Gnumeric 1.12.61 / goffice 0.10.62 values, including
// reduced-accuracy results and square overflow; see bessel-large-arguments.test.ts.
const formulas = ["BESSELJ(4503599627370497,0)", "BESSELY(1e150,0.5)", "BESSELJ(1e300,1e298)"];
const input = `<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>S</Name><Cells>${formulas.map((f, i) => `<Cell Row="0" Col="${i}">=${f}</Cell>`).join("")}</Cells></Sheet></Sheets></Workbook>`;
const environment = { env: {}, locale: "C", timezone: "UTC" };
const limits = { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000, workbookWork: 100000 };

it.each([false, true])("exports phase caches and warning counts through SDK and command (recalc=%s)", async recalc => {
  for (const command of [false, true]) {
    const volume = Volume.fromJSON({ "/input.gnumeric": input });
    const diagnostics: Diagnostic[] = [];
    let stderr = "";
    const engine = createEngine({ codecs: [], environment, limits, filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    } });
    const operation = { signal: new AbortController().signal,
      async diagnostic(diagnostic: Diagnostic) { diagnostics.push(diagnostic); },
      stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } } };
    try {
      const result = command
        ? await runCommand([...(recalc ? ["--recalc"] : []), "/input.gnumeric", "/output.xlsx"], engine, operation)
        : await engine.convert({ input: { kind: "resource", uri: "/input.gnumeric" },
          destination: { kind: "resource", uri: "/output.xlsx" }, recalc }, operation);
      expect(result.exitCode).toBe(0);
      const book = await readXlsx(new Uint8Array(volume.readFileSync("/output.xlsx") as Uint8Array),
        { ...operation, environment, limits, own() {} });
      expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual([
        { kind: "number", value: -7.8537762192392634e-9 },
        { kind: "number", value: -7.7702559600641314e-76 },
        { kind: "error", value: "#NUM!" }
      ]);
      expect(command ? stderr.split("Reduced accuracy for very large trigonometric arguments").length - 1
        : diagnostics.filter(d => d.code === "numeric-warning").length).toBe(recalc ? 8 : 4);
      expect(volume.readFileSync("/input.gnumeric", "utf8")).toBe(input);
    } finally { await engine.dispose(); }
  }
});

it("cancels on a phase warning without publishing output", async () => {
  const controller = new AbortController();
  const chunks: Uint8Array[] = [];
  const engine = createEngine({ codecs: [], environment, limits });
  try {
    await expect(engine.convert({ input: { kind: "stream", filename: "input.gnumeric", source: [new TextEncoder().encode(input)] },
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(bytes); } } },
      exportType: "Gnumeric_Excel:xlsx" }, { signal: controller.signal,
      async diagnostic(diagnostic) { if (diagnostic.code === "numeric-warning") controller.abort(); }
    })).rejects.toThrow();
    expect(controller.signal.aborted).toBe(true);
    expect(chunks).toEqual([]);
  } finally { await engine.dispose(); }
});
