import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI: sequence results retain a zero-valued write mask.
const cases = [
    { name: "identity poly", args: ["xc:#804020", "-write-mask", "xc:white", "-poly", "1,1", "-negate", "+write-mask"], hex: "7f7fbfbfdfdfffff" },
    { name: "two-image poly", args: ["(", "xc:#804020", "-write-mask", "xc:white", ")", "xc:#204080", "-poly", "0.5,1,0.5,1", "-negate", "+write-mask"], hex: "afafbfbfafafffff" },
    { name: "sequence mean", args: ["(", "xc:#804020", "-write-mask", "xc:white", ")", "xc:#204080", "-evaluate-sequence", "mean", "-negate", "+write-mask"], hex: "afafbfbfafafffff" },
    { name: "ordinary negate remains protected", args: ["xc:#804020", "-write-mask", "xc:white", "-negate", "+write-mask"], hex: "808040402020ffff" },
    { name: "explicit removal before negate", args: ["(", "xc:#804020", "-write-mask", "xc:white", ")", "xc:#204080", "-poly", "0.5,1,0.5,1", "+write-mask", "-negate"], hex: "afafbfbfafafffff" },
    { name: "zero mask retained for PNG alpha", args: ["xc:#804020", "-write-mask", "xc:white", "-poly", "1,1"], hex: "8080404020200000" },
    { name: "invalid sequence operator", args: ["xc:#804020", "-write-mask", "xc:white", "-evaluate-sequence", "invalid"], hex: undefined }
];

for (const mode of ["buffered", "sync", "retained", "command"])
for (const test of cases)
it(`${test.name} (${mode})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const keep = new TextEncoder().encode("KEEP");
    files.set("/out.raw", keep);
    await fs.writeFile("/out.raw", keep);
    const argv = [...test.args, "-depth", "16", "-endian", "MSB", "PNG64:/out.raw"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    expect(result.exitCode).toBe(test.hex ? 0 : 1);
    if (!test.hex) {
        expect(bytes).toEqual(keep);
        return;
    }
    const output = decodeImage(bytes);
    expect([output.width, output.height]).toEqual([1, 1]);
    expect(Array.from(output.data16!)).toEqual(Array.from({ length: 4 }, (_, index) => Number.parseInt(test.hex!.slice(index * 4, index * 4 + 4), 16)));
});
