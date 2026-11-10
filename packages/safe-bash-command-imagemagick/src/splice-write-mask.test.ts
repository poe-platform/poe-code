import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: opaque PPM input, decoded RGBA8 or info output.
const cases = [
    {
        name: "masked columns and row", geometry: "1x1+1+1", mask: "active", background: true, size: [5, 4],
        expected: "00070eff000000ff151c23ff2a3138ff3f464dff123456ff123456ff123456ff123456ff123456ff545b62ff000000ff697077ff7e858cff939aa1ffa8afb6ff000000ffbdc4cbffd2d9e0ffe7eef5ff",
    },
    {
        name: "masked columns", geometry: "1x0+2+0", mask: "active", background: true, size: [5, 3],
        expected: "00070eff151c23ff000000ff2a3138ff3f464dff545b62ff697077ff000000ff7e858cff939aa1ffa8afb6ffbdc4cbff000000ffd2d9e0ffe7eef5ff",
    },
    {
        name: "masked mean", geometry: "1x1+1+1", mask: "active", background: false,
        expected: "5x4 0.521765",
    },
    {
        name: "masked row", geometry: "0x1+0+1", mask: "active", background: true, size: [4, 4],
        expected: "00070eff151c23ff2a3138ff3f464dff123456ff123456ff123456ff123456ff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff",
    },
    {
        name: "cleared mask mean", geometry: "1x1+1+1", mask: "cleared", background: false,
        expected: "5x4 0.671765",
    },
    {
        name: "unmasked columns and row", geometry: "1x1+1+1", mask: "none", background: true, size: [5, 4],
        expected: "00070eff123456ff151c23ff2a3138ff3f464dff123456ff123456ff123456ff123456ff123456ff545b62ff123456ff697077ff7e858cff939aa1ffa8afb6ff123456ffbdc4cbffd2d9e0ffe7eef5ff",
    },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: splice preserves native $name`, async ({ geometry, mask, background, size, expected }) => {
        const files = new Map<string, Uint8Array>([
            ["/in.ppm", new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)])],
            ["/mask.pgm", new Uint8Array([...new TextEncoder().encode("P5\n4 3\n255\n"), 0, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255])],
            ["/out", new TextEncoder().encode("KEEP")],
        ]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.ppm", ...(mask === "none" ? [] : ["-write-mask", "/mask.pgm"]),
            ...(mask === "cleared" ? ["+write-mask"] : []), ...(background ? ["-background", "#123456"] : []),
            "-splice", geometry, ...(mask === "active" ? ["+write-mask"] : []),
            ...(size ? ["PNG32:/out"] : ["-format", "%wx%h %[fx:mean.r]", "info:/out"])];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        if (size) {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual(size);
            expect(Buffer.from(decoded.data).toString("hex")).toBe(expected);
        } else expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
