import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // Native ImageMagick Q16-HDRI uses half QuantumRange for virtual gray.
    it.each([
        ["#800080008000", "gray", 255],
        ["#801080108010", "gray", 255],
        ["#808080808080", "gray", 255],
        ["#800080008000", "black", 255],
        ["#800080008000", "white", 0],
        ["#810081008100", "gray", 255],
    ] as const)(`uses native virtual-pixel precision for %s with %s via ${mode}`, async (color, virtualPixel, expected) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["out", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const args = [`xc:${color}`, "-virtual-pixel", virtualPixel, "-lat", "3x1", "-depth", "8", "gray:out"];
        if (mode === "command") {
            expect(await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} },
            })).toMatchObject({ exitCode: 0 });
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        }
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect([...output]).toEqual([expected]);
    });
}
