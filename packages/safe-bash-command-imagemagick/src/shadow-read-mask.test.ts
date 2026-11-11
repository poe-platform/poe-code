import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: shadow retains a zeroed read-mask channel.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "attached white mask", before: ["-read-mask", "xc:white"], shadow: ["-shadow", "80x0+0+0"], after: [], mean: "0", channels: 5, pixel: "d0402066" },
        { name: "attached black mask", before: ["-read-mask", "xc:black"], shadow: ["-shadow", "80x0+0+0"], after: [], mean: "0", channels: 5, pixel: "d0402066" },
        { name: "removed mask", before: ["-read-mask", "xc:white"], shadow: ["-shadow", "80x0+0+0"], after: ["+read-mask"], mean: "0.815686", channels: 4, pixel: "d0402066" },
        { name: "no mask", before: [], shadow: ["-shadow", "80x0+0+0"], after: [], mean: "0.815686", channels: 4, pixel: "d0402066" },
        { name: "no shadow", before: ["-read-mask", "xc:white"], shadow: [], after: [], mean: "0.313725", channels: 5, pixel: "50609080" },
        { name: "blurred larger canvas", before: ["-read-mask", "xc:white"], shadow: ["-shadow", "80x1+0+0"], after: [], mean: "0", channels: 5, pixel: undefined },
    ])(`preserves shadow statistics and pixels with $name (${mode})`, async ({ name, before, shadow, after, mean, channels, pixel }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...(name === "blurred larger canvas" ? ["-size", "3x2"] : []), "xc:#50609080", ...before,
            "-background", "#d04020", ...shadow, ...after, "-depth", "8", "-write", "rgba:/pixels",
            "-format", "%[fx:mean.r]|%[channels]|%wx%h", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(`${mean}|srgba ${channels}.0|${pixel ? "1x1" : "7x6"}`);
        if (pixel) {
            const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
            expect(Buffer.from(pixels).toString("hex")).toBe(pixel);
        }
    });
}
