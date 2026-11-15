import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import {
  PdfDocument,
  cosArray,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictSet,
  decodePng
} from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import {
  createPdftoppmCommand,
  createPdftocairoCommand,
  runPdftoppmCli,
  runPdftocairoCli,
  runPdftoppmCliSync,
  runPdftocairoCliSync
} from "./index.js";

const fixture = new Uint8Array(
  readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-button-icons.pdf", import.meta.url))
);
function invalidIcon(kind: string) {
  const doc = PdfDocument.create(),
    page = doc.addPage({ width: 200, height: 100 });
  const nums = (...v: number[]) => cosArray(v.map((n) => cosNumber(n)));
  const icon = cosStream(
    cosDict({ Subtype: cosName("Form"), BBox: nums(0, 0, 40, 20) }),
    new TextEncoder().encode("/Child Do")
  );
  const ref = doc.cos.allocateObject(icon);
  const child =
    kind === "cycle"
      ? ref
      : doc.cos.allocateObject(
          cosStream(
            cosDict({
              Subtype: cosName("Image"),
              Width: cosNumber(1e9),
              Height: cosNumber(1e9),
              BitsPerComponent: cosNumber(8),
              ColorSpace: cosName("DeviceRGB")
            }),
            new Uint8Array()
          )
        );
  dictSet(icon.dict, "Resources", cosDict({ XObject: cosDict({ Child: child }) }));
  dictSet(
    page.pageDict,
    "Annots",
    cosArray([
      cosDict({
        Subtype: cosName("Widget"),
        FT: cosName("Btn"),
        Ff: cosNumber(65536),
        Rect: nums(20, 20, 180, 80),
        MK: cosDict({ I: ref, TP: cosNumber(kind === "layout" ? 7 : 1) })
      })
    ])
  );
  return doc.save();
}
for (const cairo of [false, true])
  it.each([false, true])(
    `renders icons and rejects invalid resources before publishing output (cairo=${cairo}, retained=%s)`,
    async (retained) => {
      for (const kind of ["valid", "layout", "cycle", "oversized"]) {
        const input = kind === "valid" ? fixture : invalidIcon(kind);
        const sentinel = new TextEncoder().encode("sentinel");
        const argv = [
          "-png",
          "-singlefile",
          "-f",
          kind === "valid" ? "2" : "1",
          "-l",
          kind === "valid" ? "2" : "1",
          "-r",
          "72",
          "input.pdf",
          "out"
        ];
        let output: Uint8Array;
        if (retained) {
          const fs = createMemoryFileSystem();
          await fs.mkdir("/scratch");
          await fs.writeFile("/input.pdf", input);
          await fs.writeFile("/out.png", sentinel);
          const args = createCommandArguments(argv),
            command = cairo ? createPdftocairoCommand() : createPdftoppmCommand();
          const result = command.execute({
            command: command.name,
            args: args.args,
            argumentValues: args,
            cwd: "/",
            env: { TMPDIR: "/scratch" },
            fs,
            stdin: (async function* () {})(),
            signal: new AbortController().signal,
            stdout: { write: async () => {} },
            stderr: { write: async () => {} }
          });
          if (kind === "valid") expect((await result).exitCode).toBe(0);
          else await expect(result).rejects.toThrow();
          output = await fs.readFile("/out.png");
          expect(await fs.readFile("/input.pdf")).toEqual(input);
          expect(await fs.readdir("/scratch")).toEqual([]);
        } else {
          const files = new Map([
            ["input.pdf", input],
            ["out.png", sentinel]
          ]);
          const result = (cairo ? runPdftocairoCli : runPdftoppmCli)(argv, files);
          if (kind === "valid") expect((await result).exitCode).toBe(0);
          else await expect(result).rejects.toThrow();
          output = files.get("out.png")!;
          expect(files.get("input.pdf")).toEqual(input);
        }
        if (kind === "valid") {
          const image = decodePng(output);
          expect([...image.data.slice((30 * 200 + 60) * 4, (30 * 200 + 60) * 4 + 3)]).toEqual([
            255, 0, 0
          ]);
        } else {
          expect(output, kind).toEqual(sentinel);
        }
      }
    }
  );

for (const cairo of [false, true])
  it.each([false, true])(
    `preserves all outputs when a later icon is invalid (cairo=${cairo}, retained=%s)`,
    async (retained) => {
      for (const name of ["pdf-icons-bad-bbox.pdf", "pdf-icons-recursive.pdf"]) {
        const input = new Uint8Array(
          readFileSync(new URL(`../../safe-bash-rust/tests/fixtures/${name}`, import.meta.url))
        );
        const sentinel = new TextEncoder().encode("KEEP");
        const argv = ["-png", "-r", "144", "input.pdf", "page"];
        if (retained) {
          const fs = createMemoryFileSystem();
          await fs.mkdir("/scratch");
          await fs.writeFile("/input.pdf", input);
          for (const page of [1, 2]) await fs.writeFile(`/page-${page}.png`, sentinel);
          const args = createCommandArguments(argv);
          const command = cairo ? createPdftocairoCommand() : createPdftoppmCommand();
          await expect(
            command.execute({
              command: command.name,
              args: args.args,
              argumentValues: args,
              cwd: "/",
              env: { TMPDIR: "/scratch" },
              fs,
              stdin: (async function* () {})(),
              signal: new AbortController().signal,
              stdout: { write: async () => {} },
              stderr: { write: async () => {} }
            })
          ).rejects.toThrow();
          for (const page of [1, 2])
            expect(await fs.readFile(`/page-${page}.png`)).toEqual(sentinel);
          expect(await fs.readFile("/input.pdf")).toEqual(input);
          expect(await fs.readdir("/scratch")).toEqual([]);
        } else {
          const files = new Map([
            ["input.pdf", input],
            ["page-1.png", sentinel],
            ["page-2.png", sentinel]
          ]);
          await expect((cairo ? runPdftocairoCli : runPdftoppmCli)(argv, files)).rejects.toThrow();
          for (const page of [1, 2]) expect(files.get(`page-${page}.png`)).toEqual(sentinel);
          expect(() => (cairo ? runPdftocairoCliSync : runPdftoppmCliSync)(argv, files)).toThrow();
          for (const page of [1, 2]) expect(files.get(`page-${page}.png`)).toEqual(sentinel);
          expect(files.get("input.pdf")).toEqual(input);
        }
      }
    }
  );
