import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Uint8Array.from({ length: 18 }, (_, i) => (i * 13 + 7) % 256)
]);

// Complete RGBA8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const direction of ["-append", "+append"]) {
        it.each([
            { name: "default", options: [], padding: "ffffffff" },
            { name: "explicit", options: ["-background", "lime"], padding: "00ff00ff" },
            { name: "image property", options: ["-set", "background", "lime"], padding: "00ff00ff" },
            { name: "option property", options: ["-set", "option:background", "lime"], padding: "00ff00ff" }
        ])(`${mode}: ${direction} uses $name background without changing source pixels`, async ({ options, padding }) => {
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["(", "/in.ppm", ")", "(", "/in.ppm", "-crop", "1x1+1+0", "+repage", ")",
                ...options, direction, "-depth", "8", "rgba:/pixels"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("/pixels")! : await fs.readFile("/pixels");
            expect(Buffer.from(output).toString("hex")).toBe(direction === "-append"
                ? `071421ff2e3b48ff55626fff7c8996ffa3b0bdffcad7e4ff2e3b48ff${padding}${padding}`
                : `071421ff2e3b48ff55626fff2e3b48ff7c8996ffa3b0bdffcad7e4ff${padding}`);
        });
    }
}
