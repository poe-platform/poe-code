import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick orders RGB first, descending frequency second, alpha last.
const cases = [
    { name: "repeated opaque", pixels: "123456ff12345600123456ff", rows: [[2, "123456FF"], [1, "12345600"]] },
    { name: "repeated transparent", pixels: "12345600123456ff12345600", rows: [[2, "12345600"], [1, "123456FF"]] },
    { name: "transparent first", pixels: "12345600123456ff123456ff", rows: [[2, "123456FF"], [1, "12345600"]] },
    { name: "three frequencies", pixels: "1234568012345600123456ff12345680123456ff123456ff", rows: [[3, "123456FF"], [2, "12345680"], [1, "12345600"]] },
    { name: "equal frequencies", pixels: "123456ff1234560012345680", rows: [[1, "12345600"], [1, "12345680"], [1, "123456FF"]] },
    { name: "RGB before frequency", pixels: "123457ff123456ff123457ff12345600123457ff", rows: [[1, "12345600"], [1, "123456FF"], [3, "123457FF"]] }
];
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const evaluated of [false, true]) {
        for (const depth of [8, 16]) {
            it.each(cases)(`orders histogram alpha by frequency: $name (${mode}, ${depth}-bit, evaluated=${evaluated})`, async ({ pixels, rows }) => {
                const source = Buffer.from(pixels, "hex");
                const bytes = depth === 8 ? source : Uint8Array.from([...source].flatMap(value => [value, value]));
                const files = new Map([["/in.bin", bytes]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.bin", bytes);
                const argv = ["-size", `${source.length / 4}x1`, "-depth", String(depth), "rgba:/in.bin", ...(evaluated ? ["-channel", "RGB", "-evaluate", "multiply", "1", "+channel"] : []), "-format", "%c", "histogram:info:"];
                const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
                const argumentValues = createCommandArguments(argv);
                const result = mode === "sync" ? runConvertCliSync(argv, files)
                    : mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                        stderr: { async write(chunk) { errors.push(chunk.slice()); } }
                    }) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : Buffer.concat(errors).toString()).toBe("");
                const stdout = "stdout" in result && typeof result.stdout === "string" ? result.stdout : Buffer.concat(chunks).toString();
                expect(stdout.trim().split("\n").map(row => [Number(row.slice(0, row.indexOf(":"))), row.slice(row.indexOf("#") + 1).split(" ")[0]]))
                    .toEqual(rows.map(([count, color]) => [count, depth === 8 ? color : [0, 2, 4, 6].map(offset => String(color).slice(offset, offset + 2).repeat(2)).join("")]));
            });
        }
    }
}

it.each([false, true])("preserves frequency ordering in histogram files, comments, and intermediate writes (retained=%s)", async retained => {
    const source = Buffer.from("123456ff12345600123456ff", "hex");
    const files = new Map<string, Uint8Array>([["/in.bin", source]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.bin", source);
    const input = retained ? { filesystem, cwd: "/" } : files;
    const args = ["-size", "3x1", "-depth", "8", "rgba:/in.bin", "-format", "%c"];
    const expected = "             2: (18,52,86,255) #123456FF srgba(18,52,86,1)\n             1: (18,52,86,0) #12345600 srgba(18,52,86,0)\n";
    expect(await runConvertCli([...args, "-write", "histogram:info:/rows.txt", "histogram:/plot.miff"], input))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(Buffer.from(retained ? await filesystem.readFile("/rows.txt") : files.get("/rows.txt")!).toString()).toBe(expected);
    expect(await runConvertCli(["/plot.miff", "-format", "%c", "info:"], input))
        .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});

it.each([false, true])("orders many 16-bit alpha bins across storage batches (evaluated=%s)", async evaluated => {
    const pixels = Array.from({ length: 600 }, (_, alpha) => [0x12, 0x12, 0x34, 0x34, 0x56, 0x56, alpha >> 8, alpha & 255]);
    const source = Uint8Array.from([...pixels, ...pixels.slice(300)].flat());
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.bin", source);
    const args = ["-size", "900x1", "-depth", "16", "-endian", "MSB", "rgba:/in.bin",
        ...(evaluated ? ["-channel", "RGB", "-evaluate", "multiply", "1", "+channel"] : []), "-format", "%c", "histogram:info:"];
    const result = await runConvertCli(args, { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const rows = result.stdout.trim().split("\n").map(row => [Number(row.slice(0, row.indexOf(":"))), row.slice(row.indexOf("#") + 1).split(" ")[0]]);
    expect(rows).toEqual([...pixels.keys()].map(index => (index + 300) % 600).map(alpha => [alpha >= 300 ? 2 : 1, `121234345656${alpha.toString(16).toUpperCase().padStart(4, "0")}`]));
});
