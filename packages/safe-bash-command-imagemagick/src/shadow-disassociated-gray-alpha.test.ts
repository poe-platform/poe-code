import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray shadows discard disassociated alpha;
// sRGB shadows retain it. Off and Deactivate remain distinct in both spaces.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const space of ["Gray", "sRGB"])
for (const background of ["#a135f5", "black"])
for (const opacity of [100, 45]) {
    it.each([
        { alpha: [], opaque: false },
        { alpha: ["-alpha", "disassociate"], opaque: space === "Gray" },
        { alpha: ["-alpha", "off"], opaque: true },
        { alpha: ["-alpha", "deactivate"], opaque: false },
        { alpha: ["-alpha", "disassociate", "-alpha", "on"], opaque: true },
    ])(`${mode}: ${space} ${background} shadow at ${opacity}% after $alpha`, async ({ alpha, opaque }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["xc:#345caa80", "-colorspace", space, ...alpha, "-background", background,
            "-shadow", `${opacity}x0+0+0`, "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/out"];
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? Buffer.concat(chunks)
            : mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        const expectedAlpha = opaque ? opacity === 100 ? "ff" : "73" : opacity === 100 ? "80" : "3a";
        expect(Buffer.from(output).toString("hex")).toBe((background === "black" ? "000000" : "a135f5") + expectedAlpha);
    });
}
