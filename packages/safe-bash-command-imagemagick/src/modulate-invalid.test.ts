import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "command", "sync"] as const) {
    it.each(["bogus", "80junk", "", "80,60,junk", "e", "1e"])(`rejects malformed modulation %j without replacing output via ${mode}`, async value => {
        const input = encodeImage({ width: 1, height: 1, density: 72, data: Uint8Array.of(25, 100, 220, 255), channels: 3, hasAlpha: false, space: "srgb", depth: "uchar", format: "png" }, { format: "png" }).data;
        const original = encodeImage({ width: 1, height: 1, density: 72, data: Uint8Array.of(255, 0, 0, 255), channels: 3, hasAlpha: false, space: "srgb", depth: "uchar", format: "png" }, { format: "png" }).data;
        const files = new Map([["in.png", input], ["out.png", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        await filesystem.writeFile("/out.png", original);
        const args = ["in.png", "-modulate", value, "out.png"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain("-modulate");
        expect(mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(original);
    });
    // ImageMagick 7.1.2 Q16-HDRI reference pixels for geometry forms.
    it.each([
        ["80,60,120", [71, 51, 145]],
        ["80x60+120", [71, 51, 145]],
        ["80%,60%,120%", [71, 51, 145]],
        ["80/60/120", [71, 51, 145]],
        ["8e1,6e1,1.2e2", [71, 51, 145]],
        ["80!", [20, 80, 176]],
        [",60,120", [89, 64, 181]],
        ["80,,120", [54, 20, 176]],
        ["80x", [20, 80, 176]],
    ] as const)(`accepts native modulation geometry %s via ${mode}`, async (value, rgb) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:#1964dc", "-modulate", value, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "command" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([...rgb, 255]);
    });
}
