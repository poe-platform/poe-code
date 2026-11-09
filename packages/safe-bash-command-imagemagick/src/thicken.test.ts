import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 vectors for a 7x5 mask with six foreground pixels.
const foreground = [9, 10, 16, 22, 23, 24];
const cases = [
    { method: "Thicken", kernel: "3x1:1,0,0", added: [11, 17, 25] },
    { method: "Thicken", kernel: "3x1:0,0,1", added: [8, 15, 21] },
    { method: "Thicken", kernel: "3x1:1,0,1", added: [] },
    { method: "Dilate", kernel: "Square:1", added: [1, 2, 3, 4, 8, 11, 14, 15, 17, 18, 21, 25, 28, 29, 30, 31, 32] },
    { method: "Thicken:0", kernel: "3x1:1,0,0", added: [] },
    { method: "Thicken:2", kernel: "3x1:1,0,0", added: [11, 12, 17, 18, 25, 26] },
];
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const channel of [undefined, "R"])
it.each(cases)(`grows only matched background pixels (${mode}, channel=${channel}, $method $kernel)`, async ({ method, kernel, added }) => {
    const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Array.from({ length: 35 }, (_, i) => foreground.includes(i) ? 255 : 0)]);
    const fs = new MemoryFileSystem(), files = new Map([["/mask.pgm", input]]);
    await fs.writeFile("/mask.pgm", input);
    const args = ["/mask.pgm", ...(channel ? ["-channel", channel] : []), "-morphology", method, kernel, "/out.ppm"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.ppm")! : await fs.readFile("/out.ppm"));
    const expected = Uint8Array.from({ length: 35 * 4 }, (_, i) =>
        i % 4 === 3 || foreground.includes(Math.floor(i / 4)) || ((!channel || i % 4 === 0) && added.includes(Math.floor(i / 4))) ? 255 : 0);
    expect(output.data).toEqual(expected);
});
