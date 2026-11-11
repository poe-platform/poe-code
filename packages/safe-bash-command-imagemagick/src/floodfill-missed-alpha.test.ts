import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const translucent of [true, false]) {
        it.each([
            { space: "sRGB", channels: "srgb", count: 3 },
            { space: "CMYK", channels: "cmyk", count: 4 },
            { space: "Lab", channels: "cielab", count: 3 },
            { space: "DisplayP3", channels: "displayp3", count: 3 },
            { space: "RGB", channels: "rgb", count: 3 }
        ])(`${mode}: missed floodfill in $space activates alpha only for translucent fill (${translucent})`, async ({ space, channels, count }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#34a05c", "-colorspace", space, "-fill", translucent ? "#cf468380" : "#cf4683",
                "-floodfill", "+0+0", "black", "-format", "%[channels]", "-write", "info:channels",
                "-channel", "A", "-evaluate", "set", "25%", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/channels") : files.get("channels")!;
            expect(new TextDecoder().decode(metadata)).toBe(`${channels}${translucent ? "a " : "  "}${count + Number(translucent)}.0`);
            expect([...output]).toEqual([0x34, 0xa0, 0x5c, translucent ? 0x40 : 0xff]);
        });
    }
}
