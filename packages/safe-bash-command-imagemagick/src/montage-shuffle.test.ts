import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors = { R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0], C: [0, 255, 255], ".": [0, 0, 0] };
const inputs = ["xc:red", "xc:lime", "xc:blue", "xc:yellow", "xc:cyan"];

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  it.each([
    { inputs, order: "RGBYC." },
    { inputs: [...inputs, "-shuffle", "Ascending"], order: "BCGRY." },
    { inputs: ["canvas:red", "xc:lime", "xc:blue", "xc:yellow", "xc:cyan", "-shuffle", "Ascending"], order: "BCGRY." },
    { inputs: [...inputs, "-shuffle", "Descending"], order: "YRGCB." },
    { inputs: [...inputs, "-shuffle", "aScEnDiNg"], order: "BCGRY." },
    { inputs: [...inputs, "-shuffle", "Ascending", "-reverse"], order: "YRGCB." },
    { inputs: [...inputs, "-shuffle", "Ascending", "-shuffle", "Descending"], order: "YRGCB." },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-shuffle", "Ascending", ")", "xc:yellow", "xc:cyan"], order: "RBGYC." },
    { inputs: ["xc:red", "xc:lime", "-shuffle", "Ascending", "xc:blue", "xc:yellow", "xc:cyan"], order: "GRBYC." },
    { inputs: ["xc:RED", "xc:lime", "xc:Blue", "xc:yellow", "xc:cyan", "-shuffle", "Ascending"], order: "BCGRY." },
  ])(`${mode}: orders montage tiles for $inputs`, async ({ inputs, order }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = [...inputs, "-background", "black", "-tile", "3x2", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    let bytes: Uint8Array | undefined, stderr = "", exitCode: number;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const context: CommandContext = {
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
      };
      exitCode = (await command.execute(context)).exitCode;
      bytes = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      ({ exitCode, stderr, stdoutBytes: bytes } = result);
    }
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(Buffer.from(bytes ?? [])).toEqual(Buffer.concat([
      Buffer.from("P6\n3 2\n255\n"), Buffer.from([...order].flatMap(color => colors[color as keyof typeof colors]))
    ]));
  });
}

it("preserves per-input sizes and transforms when sorting expanded filenames", () => {
  const files = new Map<string, Uint8Array>([
    ["b.rgb", new Uint8Array([255, 0, 0])],
    ["A.rgb", new Uint8Array([0, 0, 255, 0, 255, 0])],
    ["inputs.txt", new TextEncoder().encode("rgb:A.rgb")]
  ]);
  const result = runMontageCliSync([
    "-size", "1x1", "-depth", "8", "b.rgb", "(", "-size", "2x1", "@inputs.txt", "-flop", ")",
    "-shuffle", "Ascending", "-background", "black", "-tile", "2x1", "-geometry", "+0+0", "ppm:-"
  ], files);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdoutBytes ?? [])).toEqual(Buffer.concat([
    Buffer.from("P6\n3 1\n255\n"), Buffer.from([0, 255, 0, 0, 0, 255, 255, 0, 0])
  ]));
});

it.each([
  { options: ["-shuffle"], error: "missing argument for -shuffle" },
  { options: ["-shuffle", "banana"], error: "unrecognized image shuffle 'banana'" }
])("rejects invalid shuffle arguments: $options", ({ options, error }) => {
  const files = new Map<string, Uint8Array>();
  expect(runMontageCliSync(["xc:red", ...options], files)).toMatchObject({
    exitCode: 1, stdout: "", stderr: `montage: ${error}\n`
  });
  expect(files.size).toBe(0);
});
