import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// External 8-bit RGB PNGs: grayscale planes [10, 250], [0, 240], [0, 230].
const planes = [
    "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f4944415408d763e0e2e2faf5eb17000679030d07c0b55b0000000049454e44ae426082",
    "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f4944415408d763606060f8f0e1030005a702d1f387ae920000000049454e44ae426082",
    "89504e470d0a1a0a0000000d49484452000000020000000108020000007b40e8dd0000000f4944415408d76360606078f6ec1900056b02b3ab2e88370000000049454e44ae426082"
];

for (const mode of ["buffered", "sync", "retained", "command"])
for (const before of [false, true])
for (const after of [false, true])
it(`preserves RGB planes across combine (${mode}, evaluate before=${before}, after=${after})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const names = planes.map((_, index) => `/plane${index}.png`);
    for (const [index, name] of names.entries()) {
        const bytes = Buffer.from(planes[index]!, "hex");
        files.set(name, bytes);
        await fs.writeFile(name, bytes);
    }
    const argv = [...names, ...(before ? ["-evaluate", "Add", "0"] : []), "-combine",
        ...(after ? ["-evaluate", "Add", "0"] : []), "-depth", "16", "/out.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([2, 1]);
    // Native ImageMagick Q16-HDRI yields these same samples in all four cases.
    expect(Array.from(output.data16 ?? Uint16Array.from(output.data, value => value * 257))).toEqual([2570, 0, 0, 65535, 64250, 61680, 59110, 65535]);
});
