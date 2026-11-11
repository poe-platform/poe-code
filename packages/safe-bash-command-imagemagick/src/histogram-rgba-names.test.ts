import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI names only exact opaque colors and transparent black.
const cases = [
    { pixel: "ff0000ff", row: "(255,0,0,255) #FF0000FF red" },
    { pixel: "00000000", row: "(0,0,0,0) #00000000 none" },
    { pixel: "ff000080", row: "(255,0,0,128) #FF000080 srgba(255,0,0,0.501961)" },
    { pixel: "010203ff", row: "(1,2,3,255) #010203FF srgba(1,2,3,1)" },
    { pixel: "ff000000", row: "(255,0,0,0) #FF000000 srgba(255,0,0,0)" },
    { pixel: "00ff00ff", row: "(0,255,0,255) #00FF00FF lime" },
    { pixel: "000000ff", row: "(0,0,0,255) #000000FF black" },
    { pixel: "ff0000ffff000080", row: "(255,0,0,128) #FF000080 srgba(255,0,0,0.501961)\n             1: (255,0,0,255) #FF0000FF red" },
];
for (const mode of ["public", "buffered", "sync", "retained", "streamed"] as const) {
    it.each(cases)(`uses native RGBA histogram names for $pixel (${mode})`, async ({ pixel, row }) => {
        const bytes = new Uint8Array(Buffer.from(pixel, "hex"));
        const files = new Map([["/in.raw", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.raw", bytes);
        let stdout = "", stderr = "";
        const sink = { async write(chunk: Uint8Array) { stdout += new TextDecoder().decode(chunk); } };
        const args = ["-size", `${bytes.length / 4}x1`, "-depth", "8", "rgba:/in.raw", "-format", "%c", "histogram:info:-"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink,
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : {
                filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: sink } : {})
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(mode === "public" || mode === "streamed" ? stdout : "stdout" in result ? result.stdout : "")
            .toBe(`             1: ${row}\n`);
    });
}

for (const retained of [false, true]) {
    it.each([
        { pixel: "ffff00000000ffff", row: "(65535,0,0,65535) #FFFF00000000FFFF red" },
        { pixel: "0000000000000000", row: "(0,0,0,0) #0000000000000000 none" },
        { pixel: "fffe00000000ffff", row: "(65534,0,0,65535) #FFFE00000000FFFF srgba(99.9985%,0%,0%,1)" },
        { pixel: "ffff00000000fffe", row: "(65535,0,0,65534) #FFFF00000000FFFE srgba(255,0,0,0.999985)" },
    ])(`preserves exact 16-bit RGBA histogram names for $pixel (retained=${retained})`, async ({ pixel, row }) => {
        const bytes = new Uint8Array(Buffer.from(pixel, "hex"));
        const filesystem = new MemoryFileSystem(), files = new Map([["/in.raw", bytes]]);
        await filesystem.writeFile("/in.raw", bytes);
        expect(await runConvertCli(["-size", "1x1", "-depth", "16", "-endian", "MSB", "rgba:/in.raw", "-format", "%c", "histogram:info:-"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: `             1: ${row}\n`, stderr: "" });
    });
}
