import { expect, it } from "vitest";
import { readMiffHeader } from "../../image-ast/src/codecs/miff-input.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including rereading the saved MIFF frames.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const output of ["info", "miff"] as const)
it.each([
    { name: "Add", operation: ["-complex", "Add"], expected: "32:0.517647;32:0.133333;" },
    { name: "Conjugate", operation: ["-complex", "Conjugate"], expected: "32:0.258824;32:-0.0666667;" },
    { name: "Conjugate with RLE", operation: ["-complex", "Conjugate", "-compress", "RLE"], expected: "32:0.258824;32:-0.0666667;" },
    { name: "later depth override", operation: ["-complex", "Add", "-depth", "16"], expected: "16:0.517647;16:0.133333;" },
    { name: "unchanged inputs", operation: [], expected: "8:0.258824;8:0.0666667;" }
])(`${mode}: complex $name depth in ${output}`, async ({ operation, expected }) => {
    const files = new Map<string, Uint8Array>([
        ["/a.ppm", Buffer.from("P3\n2 1\n255\n66 23 41 19 110 221\n")],
        ["/b.ppm", Buffer.from("P3\n1 2\n255\n17 67 93 208 112 49\n")],
        ["/out.miff", Buffer.from("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const format = ["-format", "%z:%[fx:r];", "info:"];
    let actual = "";
    for (const argv of output === "info" ? [["/a.ppm", "/b.ppm", ...operation, ...format]]
        : [["/a.ppm", "/b.ppm", ...operation, "/out.miff"]]) {
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        actual += "stdout" in result ? result.stdout : stdout;
    }
    if (output === "miff") {
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.miff") : files.get("/out.miff")!;
        const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        actual = [0, 1].map(page => {
            const { metadata, offset } = readMiffHeader(bytes, page);
            expect([metadata.width, metadata.height]).toEqual(page === 0 ? [2, 1] : [1, 2]);
            const depth = metadata.bitsPerSample;
            const red = metadata.depth === "float" ? samples.getFloat32(offset)
                : depth === 32 ? samples.getUint32(offset) / 4294967295
                : depth === 16 ? samples.getUint16(offset) / 65535 : samples.getUint8(offset) / 255;
            return `${depth}:${Number(red.toPrecision(6))};`;
        }).join("");
    }
    expect(actual).toBe(expected);
});
