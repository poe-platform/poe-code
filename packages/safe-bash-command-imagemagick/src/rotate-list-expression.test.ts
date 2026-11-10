import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ffffee00991177245384", "hex")]);

// ImageMagick 7.1.2-35 Q16-HDRI: dimensions and first pixel distinguish 0/90/180 degrees.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["%[fx:n*90]", "3x2,srgb(36,83,132);3x2,srgb(36,83,132);"],
        ["%[fx:t*90]", "3x2,srgb(255,0,0);2x3,srgb(255,238,0);"],
        ["180", "3x2,srgb(36,83,132);3x2,srgb(36,83,132);"],
    ])(`uses the current image list for rotation %s (${mode})`, async (angle, expected) => {
        const files = new Map<string, Uint8Array>([["im.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/im.ppm", input);
        const args = ["im.ppm", "im.ppm", "-rotate", angle, "-format", "%wx%h,%[pixel:p{0,0}];", "info:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
