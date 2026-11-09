import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick carries delay/disposal across absent GCEs, but a new GCE replaces them.
const fixtures = [
  { name: "missing second GCE", base64: "R0lGODlhAgABAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwECAAAh+QQIBwAAACwAAAAAAgABAAACAgRTACwAAAAAAgABAAACAgxRADs=", delay: [70, 70], disposal: [2, 2] },
  { name: "later explicit GCE", base64: "R0lGODlhAgABAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwECAAAh+QQMBAAAACwAAAAAAgABAAACAgRTACwAAAAAAgABAAACAgxRACH5BAQVAAAALAAAAAACAAEAAAICBFMAOw==", delay: [40, 40, 210], disposal: [3, 3, 1] },
  { name: "explicit controls", base64: "R0lGODlhAgABAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwECAAAh+QQIBwAAACwAAAAAAgABAAACAgRTACH5BAQXAAAALAAAAAACAAEAAAICDFEAOw==", delay: [70, 230], disposal: [2, 1] }
];
for (const mode of ["buffered", "retained", "command"]) {
  it.each(fixtures)(`preserves $name (${mode})`, async ({ base64, delay, disposal }) => {
    const input = new Uint8Array(Buffer.from(base64, "base64"));
    const fs = new MemoryFileSystem();
    const seed = new TextEncoder().encode("keep");
    await fs.writeFile("/in.gif", input);
    await fs.writeFile("/out.gif", seed);
    const files = new Map([["/in.gif", input], ["/out.gif", seed]]);
    const args = ["/in.gif", "/out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    const decoded = decodeImage(output, { animated: true });
    expect(decoded).toMatchObject({ delay, loop: 3 });
    expect(disposal.map((_, page) => decodeImage(output, { page, coalesce: false }).disposal)).toEqual(disposal);
    const pixels = Buffer.from("ff0000ff00ff00ff00ff00ffff0000ff" + (delay.length === 3 ? "ff0000ff00ff00ff" : ""), "hex");
    expect(decoded.data).toEqual(new Uint8Array(pixels));
    expect(decodeImage(input, { animated: true }).data).toEqual(new Uint8Array(pixels));
  });
}

for (const retained of [false, true]) {
  it(`does not inherit transparency and accepts explicit zero controls (retained=${retained})`, async () => {
    const input = new Uint8Array(Buffer.from(fixtures[0]!.base64, "base64"));
    input[41] = 9; // First GCE: background disposal and transparent palette index zero.
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    const files = new Map([["/in.gif", input]]);
    expect(await runConvertCli(["/in.gif", "/out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
    expect(decodeImage(output, { page: 0, coalesce: false }).hasAlpha).toBe(true);
    expect(decodeImage(output, { page: 1, coalesce: false })).toMatchObject({ hasAlpha: false, disposal: 2 });

    const explicit = new Uint8Array(Buffer.from(fixtures[2]!.base64, "base64"));
    explicit[64] = 0; // Second GCE explicitly resets disposal and delay.
    explicit[65] = 0;
    await fs.writeFile("/in.gif", explicit);
    files.set("/in.gif", explicit);
    expect(await runConvertCli(["/in.gif", "/out.gif"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const reset = retained ? await fs.readFile("/out.gif") : files.get("/out.gif")!;
    expect(decodeImage(reset, { animated: true }).delay).toEqual([70, 0]);
    expect(decodeImage(reset, { page: 1, coalesce: false }).disposal).toBe(0);
  });
}
