import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGBA8 reference bytes from ImageMagick 7.1.2-35 Q16-HDRI.
const operations = [
  { operation: "Add", expected: [128, 192, 128, 255] },
  { operation: "And", expected: [32, 0, 32, 128] },
  { operation: "Divide", expected: [0, 0, 0, 0] },
  { operation: "Log", expected: [227, 237, 203, 244] },
  { operation: "Multiply", expected: [12, 32, 12, 80] },
  { operation: "Or", expected: [96, 192, 96, 160] },
  { operation: "RMS", expected: [68, 91, 23, 113] },
  { operation: "Set", expected: [32, 64, 96, 128] },
  { operation: "Sin", expected: [199, 255, 199, 36] },
  { operation: "Subtract", expected: [64, 64, 0, 32] },
  { operation: "Threshold", expected: [255, 255, 0, 255] },
  { operation: "Xor", expected: [64, 192, 64, 32] },
  { operation: "Max", expected: [96, 128, 96, 160] },
  { operation: "Mean", expected: [64, 96, 64, 144] },
  { operation: "Median", expected: [96, 128, 32, 160] },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const count of [1, 2]) {
    for (const channel of ["R", "A", "default", "reset"]) {
      it.each(operations)(`${mode}: $operation with ${channel} over ${count} inputs`, async ({ operation, expected }) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        const args = [
          ...["xc:#20406080", "xc:#608020a0"].slice(0, count),
          ...(channel === "default" ? [] : channel === "reset" ? ["-channel", "R", "+channel"] : ["-channel", channel]),
          "-evaluate-sequence", operation, "+channel", "-depth", "8", "rgba:/out",
        ];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        const pixel = count === 2 ? expected : operation === "RMS" ? [0, 0, 1, 1] : [32, 64, 96, 128];
        expect([...bytes]).toEqual(pixel.map((value, index) => channel === "R" ? index === 0 ? value : 0 : channel === "A" ? index === 3 ? value : 0 : value));
      });
    }
  }
}

it.each(["R", "A"])("Add clears unselected working samples before subsequent evaluation (%s)", async channel => {
  const files = new Map<string, Uint8Array>();
  const result = await runMagickCli([
    "xc:#20406080", "xc:#608020a0", "-channel", channel, "-evaluate-sequence", "Add",
    "+channel", "-evaluate", "Divide", "2", "-depth", "8", "rgba:/out",
  ], files);
  expect(result).toMatchObject({ exitCode: 0 });
  expect([...files.get("/out")!]).toEqual(channel === "R" ? [64, 0, 0, 0] : [0, 0, 0, 144]);
});
