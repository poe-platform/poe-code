import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: shadows use independent RGB channels even for neutral backgrounds.
const cases = [
    { name: "default white", background: [], pixel: "00ffff80" },
    { name: "black", background: ["-background", "black"], pixel: "ff000080" },
    { name: "neutral gray", background: ["-background", "#555555"], pixel: "aa555580" },
    { name: "red", background: ["-background", "red"], pixel: "00000080" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const space of ["Gray", "sRGB"]) {
        it.each(cases)(`keeps RGB shadow channels with $name background (${space}, ${mode})`, async ({ background, pixel }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = ["xc:#345caa80", "-colorspace", space, ...background, "-shadow", "100x0+0+0",
                "-format", "%[colorspace]", "-write", "info:/space", "-channel", "R", "-negate", "+channel",
                "-depth", "8", "rgba:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const colorspace = mode === "command" || mode === "retained" ? await fs.readFile("/space") : files.get("/space")!;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect.soft(new TextDecoder().decode(colorspace)).toBe("sRGB");
            expect(Buffer.from(output).toString("hex")).toBe(pixel);
        });
    }
}
