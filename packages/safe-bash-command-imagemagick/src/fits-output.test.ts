import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const input = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from("8020100040ff", "hex")]);

function checkFits(bytes: Uint8Array): void {
  expect(bytes).toHaveLength(5760);
  const cards = new Map<string, string>();
  for (let offset = 0; offset < 2880; offset += 80) {
    const card = new TextDecoder().decode(bytes.subarray(offset, offset + 80));
    if (card.trim() === "END") {
      expect(bytes.subarray(offset + 80, 2880).every(byte => byte === 32)).toBe(true);
      break;
    }
    cards.set(card.slice(0, 8).trim(), card.slice(10).trim());
  }
  expect(Object.fromEntries(cards)).toMatchObject({ SIMPLE: "T", BITPIX: "8", NAXIS: "2", NAXIS1: "3", NAXIS2: "2" });
  expect(Buffer.from(bytes.subarray(2880, 2886)).toString("hex")).toBe("0040ff802010");
  expect(bytes.subarray(2886).every(byte => byte === 0)).toBe(true);
}

for (const retained of [false, true]) for (const output of ["/out.fits", "FITS:/out.bin", "/out.fts", "FTS:/out.bin"]) for (const write of [false, true]) {
  it(`writes FITS primary image (${output}, retained=${retained}, write=${write})`, async () => {
    const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pgm", input);
    const result = await runConvertCli(["/in.pgm", ...(write ? ["-write", output, "/out.png"] : [output])], retained ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const path = output.includes(":") ? output.slice(output.indexOf(":") + 1) : output;
    checkFits(retained ? await filesystem.readFile(path) : files.get(path)!);
  });
}

it("writes FITS through the public magick command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.pgm", input);
  const argumentValues = createCommandArguments(["/in.pgm", "/out.fits"]);
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, env: {}, cwd: "/", fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  checkFits(await fs.readFile("/out.fits"));
});
