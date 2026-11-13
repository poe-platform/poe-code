import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdftoppmCommand, createPdftocairoCommand, runPdftoppmCli, runPdftocairoCli } from "./index.js";

const input = new Uint8Array(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/embedded-font.pdf", import.meta.url)));
function replace(bytes: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length);
  const copy = Buffer.from(bytes);
  const at = copy.indexOf(from);
  expect(at).toBeGreaterThanOrEqual(0);
  copy.set(Buffer.from(to), at);
  return copy;
}
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} renders embedded simple TrueType text`, async () => {
    const files = new Map([["input.pdf", input]]);
    const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
    expect(result.exitCode).toBe(0);
    const png = decodePng(files.get("page.png")!);
    let dark = 0;
    for (let y = 20; y < 115; y++) for (let x = 15; x < 305; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i]! < 60 && png.data[i + 1]! < 60 && png.data[i + 2]! < 60) dark++;
    }
    expect(dark).toBeGreaterThan(1000);
  });
}

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} keeps empty embedded glyphs blank`, async () => {
    const blank = replace(replace(input, "Invoice 0123", "            "), "Text must survive", "                 ");
    const files = new Map([["input.pdf", blank]]);
    expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode).toBe(0);
    const png = decodePng(files.get("page.png")!);
    for (let y = 20; y < 115; y++) for (let x = 15; x < 305; x++) {
      expect(png.data[(y * png.width + x) * 4]).toBeGreaterThan(200);
    }
  });
  it(`${run.name} rejects malformed embedded fonts without replacing output`, async () => {
    const invalid = replace(input, "/FontFile2 6", "/FontFile2 5");
    const existing = new Uint8Array([1, 2, 3]);
    const files = new Map([["input.pdf", invalid], ["page.png", existing]]);
    await expect(run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).rejects.toThrow("sfnt header");
    expect(files.get("page.png")).toEqual(existing);
  });
}

for (const command of [createPdftoppmCommand(), createPdftocairoCommand()]) {
  it(`${command.name} retains blank glyphs and preserves output on font errors`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp");
    const blank = replace(replace(input, "Invoice 0123", "            "), "Text must survive", "                 ");
    const standard = replace(replace(replace(input, "/FontDescriptor", "/UnusedFontDesc"), "/DejaVuSans", "/Helvetica "), "/TrueType", "/Type1   ");
    const invalid = replace(input, "/FontFile2 6", "/FontFile2 5");
    const existing = new Uint8Array([1, 2, 3]);
    for (const [bytes, visible] of [[input, true], [blank, false], [standard, true], [invalid, false]] as const) {
      await fs.writeFile("/input.pdf", bytes);
      await fs.writeFile("/page.png", existing);
      const args = createCommandArguments(["-png", "-r", "72", "-singlefile", "/input.pdf", "/page"]);
      const execution = command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal, stdout: { write: async () => {} }, stderr: { write: async () => {} } });
      if (bytes === invalid) {
        await expect(execution).rejects.toThrow("sfnt header");
        expect(await fs.readFile("/page.png")).toEqual(existing);
      } else {
        expect((await execution).exitCode).toBe(0);
        const png = decodePng(await fs.readFile("/page.png"));
        let dark = 0;
        for (let y = 20; y < 115; y++) for (let x = 15; x < 305; x++) {
          const i = (y * png.width + x) * 4;
          if (png.data[i]! < 60 && png.data[i + 1]! < 60 && png.data[i + 2]! < 60) dark++;
        }
        if (visible) expect(dark).toBeGreaterThan(1000);
        else expect(dark).toBe(0);
      }
    }
  });
}
