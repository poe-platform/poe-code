import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosString,
  cosStream,
  dictSet,
  decodePng
} from "@poe-code/pdf-ast";
import {
  createPdftoppmCommand,
  createPdftocairoCommand,
  runPdftoppmCli,
  runPdftoppmCliSync,
  runPdftocairoCli,
  runPdftocairoCliSync
} from "./index.js";
const textWidgets = new Uint8Array(
  readFileSync(
    new URL("../../safe-bash-rust/tests/fixtures/pdf-widgets-extended.pdf", import.meta.url)
  )
);
const buttons = new Uint8Array(
  readFileSync(
    new URL("../../safe-bash-rust/tests/fixtures/pdf-buttons-extended.pdf", import.meta.url)
  )
);
for (const { kind, bytes: pdf, count, first, last } of [
  { kind: "text/choice", bytes: textWidgets, count: 20, first: 8, last: 10 },
  { kind: "button", bytes: buttons, count: 30, first: 19, last: 20 }
]) {
  for (const run of [runPdftoppmCli, runPdftoppmCliSync, runPdftocairoCli, runPdftocairoCliSync])
    it(`${run.name} renders and hides ${kind} widgets`, async () => {
      const doc = PdfDocument.load(pdf);
      for (const hide of [false, true]) {
        const files = new Map([["input.pdf", pdf]]);
        const result = await run(
          [...(hide ? ["-hide-annotations"] : []), "-png", "-r", "72", "input.pdf", "page"],
          files
        );
        expect(result.exitCode, result.stderr).toBe(0);
        const outputs = [...files.entries()]
          .filter(([name]) => name.startsWith("page-"))
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
        expect(outputs).toHaveLength(count);
        for (const [i, [, bytes]] of outputs.entries())
          expect(
            Buffer.from(decodePng(bytes).data).equals(
              Buffer.from(
                doc.getPage(i).renderToBitmap({
                  scale: 1,
                  hideAnnotations: hide,
                  cairoSolidColors: run.name.includes("cairo")
                }).data
              )
            ),
            `page ${i + 1}`
          ).toBe(true);
        expect(Buffer.from(files.get("input.pdf")!).equals(Buffer.from(pdf))).toBe(true);
      }
    });
  for (const command of ["pdftoppm", "pdftocairo"] as const)
    it(`${command} retains ${kind} resources through the VFS command`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/scratch");
      await fs.writeFile("/input.pdf", pdf);
      const run = command === "pdftoppm" ? createPdftoppmCommand() : createPdftocairoCommand();
      const args = createCommandArguments([
        "-png",
        "-r",
        "72",
        "-f",
        String(first),
        "-l",
        String(last),
        "input.pdf",
        "page"
      ]);
      let stderr = "";
      const result = await run.execute({
        command,
        args: args.args,
        argumentValues: args,
        cwd: "/",
        env: { TMPDIR: "/scratch" },
        fs,
        stdin: (async function* () {})(),
        signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: {
          write: async (s) => {
            stderr += s;
          }
        }
      });
      expect(result.exitCode, stderr).toBe(0);
      const reference = new Map([["input.pdf", pdf]]);
      await (command === "pdftoppm" ? runPdftoppmCliSync : runPdftocairoCliSync)(
        ["-png", "-r", "72", "-f", String(first), "-l", String(last), "input.pdf", "page"],
        reference
      );
      for (const [name, bytes] of reference)
        if (name.startsWith("page-"))
          expect(
            Buffer.from(decodePng(await fs.readFile(`/${name}`)).data).equals(
              Buffer.from(decodePng(bytes).data)
            ),
            name
          ).toBe(true);
      expect(Buffer.from(await fs.readFile("/input.pdf")).equals(Buffer.from(pdf))).toBe(true);
      expect(await fs.readdir("/scratch")).toEqual([]);
    });
}
it("rejects invalid widget geometry, cyclic inheritance and excessive content before writing", async () => {
  const numbers = (a: number[]) => cosArray(a.map((n) => cosNumber(n)));
  const cases = [
    { Rect: numbers([1, 2, 3]) },
    { MK: cosDict({ BG: numbers([1, 2]) }) },
    { Ff: cosNumber(16777216), MaxLen: cosNumber(65537) },
    { V: cosString("x".repeat(65537)) },
    { MK: cosDict({ BC: numbers([0]) }), BS: cosDict({ S: cosName("D"), D: numbers([-1]) }) },
    { cycle: true },
    { FT: cosName("Btn"), Ff: cosNumber(65536), MK: cosDict({ CA: cosString("x".repeat(65537)) }) },
    { FT: cosName("Btn"), MK: cosDict({ R: cosNumber(13) }) }
  ];
  for (const { cycle, ...extra } of cases) {
    const doc = PdfDocument.create(),
      page = doc.addPage([100, 100]);
    const annot = cosDict({
      Subtype: cosName("Widget"),
      FT: cosName("Tx"),
      Rect: numbers([0, 0, 100, 100]),
      ...extra
    });
    const ref = doc.cos.allocateObject(annot);
    if (cycle) dictSet(annot, "Parent", ref);
    dictSet(page.pageDict, "Annots", cosArray([ref]));
    const source = doc.save();
    for (const run of [runPdftoppmCli, runPdftocairoCliSync]) {
      const sentinel = Uint8Array.of(42),
        files = new Map([
          ["input.pdf", source],
          ["out-1.png", sentinel]
        ]);
      await expect(
        Promise.resolve().then(() => run(["-png", "-r", "72", "input.pdf", "out"], files))
      ).rejects.toThrow(/PDF widget/);
      expect([...files.keys()]).toEqual(["input.pdf", "out-1.png"]);
      expect(files.get("out-1.png")).toBe(sentinel);
      expect(Buffer.from(files.get("input.pdf")!).equals(Buffer.from(source))).toBe(true);
      expect(
        (await run(["-hide-annotations", "-png", "-r", "72", "input.pdf", "out"], files)).exitCode
      ).toBe(0);
    }
  }
});
it("keeps an explicitly empty appearance empty", () => {
  const doc = PdfDocument.create(),
    page = doc.addPage([100, 100]);
  dictSet(
    page.pageDict,
    "Annots",
    cosArray([
      cosDict({
        Subtype: cosName("Widget"),
        FT: cosName("Tx"),
        V: cosString("Must stay hidden"),
        Rect: cosArray([0, 0, 100, 100].map((n) => cosNumber(n))),
        AP: cosDict({
          N: doc.cos.allocateObject(
            cosStream(
              cosDict({ BBox: cosArray([0, 0, 100, 100].map((n) => cosNumber(n))) }),
              new Uint8Array()
            )
          )
        })
      })
    ])
  );
  expect(page.renderToBitmap({ scale: 1 }).data.every((v) => v === 255)).toBe(true);
});
