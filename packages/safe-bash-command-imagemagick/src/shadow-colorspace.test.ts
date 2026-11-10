import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 pixels after conversion back to sRGB.
const cases = [
    { space: "Lab", shadow: true, pixel: "00ffff66" },
    { space: "HSL", shadow: true, pixel: "26182866" },
    { space: "Lab", shadow: false, pixel: "5080c080" },
    { space: "HSL", shadow: false, pixel: "5080c080" },
    { space: "sRGB", shadow: true, pixel: "d0402066" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`preserves native $space pixels after shadow=$shadow (${mode})`, async ({ space, shadow, pixel }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = ["-size", "3x2", "xc:#5080c080", "-colorspace", space, "-background", "#d04020",
            ...(shadow ? ["-shadow", "80x0+0+0"] : []), "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(pixel.repeat(6));
    });
}
