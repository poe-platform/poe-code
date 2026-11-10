import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./compare-profile-fixtures.json" with { type: "json" };

const icc = Uint8Array.from(Buffer.from(fixtures["srgb.icc"], "base64"));
// Little-endian TIFF: IFD0 Make and Model, with out-of-line ASCII values.
const exif = new Uint8Array(60);
exif.set([73, 73, 42, 0, 8, 0, 0, 0, 2, 0]);
const view = new DataView(exif.buffer);
for (const [index, tag, value, offset] of [[0, 271, "ParityCamera", 38], [1, 272, "ModelOne", 51]] as const) {
    const entry = 10 + index * 12;
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, 2, true);
    view.setUint32(entry + 4, value.length + 1, true);
    view.setUint32(entry + 8, offset, true);
    exif.set(new TextEncoder().encode(value), offset);
}
const tagged = encodeImage({ width: 4, height: 3, data: new Uint8Array(48).fill(255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true, icc, exif }, { format: "png" }).data;
const plain = encodeImage({ width: 3, height: 5, data: new Uint8Array(60).fill(255), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "horizontal", inputs: ["/tagged.png", "/plain.png"], operation: ["+smush", "0"], size: [7, 5], profiles: true },
        { name: "vertical", inputs: ["/tagged.png", "/plain.png"], operation: ["-smush", "1"], size: [4, 9], profiles: true },
        { name: "reversed horizontal", inputs: ["/plain.png", "/tagged.png"], operation: ["+smush", "0"], size: [7, 5], profiles: false },
        { name: "reversed vertical", inputs: ["/plain.png", "/tagged.png"], operation: ["-smush", "1"], size: [4, 9], profiles: false },
        { name: "rewrite control", inputs: ["/tagged.png"], operation: [], size: [4, 3], profiles: true },
    ])(`${mode}: preserves only the first input's profiles ($name)`, async ({ inputs, operation, size, profiles }) => {
        const files = new Map([["/tagged.png", tagged.slice()], ["/plain.png", plain.slice()]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = [...inputs, ...operation, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual(size);
        expect.soft(output.icc).toEqual(profiles ? icc : undefined);
        expect(output.exif).toEqual(profiles ? exif : undefined);
    });
}
