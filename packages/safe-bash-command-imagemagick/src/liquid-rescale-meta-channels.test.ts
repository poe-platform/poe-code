import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        // Shrink samples verified with native ImageMagick 7.1.2-35 Q16-HDRI.
        ["3x3!", "3x3", [8, 9, 10, 13, 14, 15, 18, 19, 20]],
        ["6x5!", "6x5", [1, 1, 2, 3, 4, 5, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10, 11, 11, 12, 13, 14, 15, 16, 16, 17, 18, 19, 20]],
        ["5x4!", "5x4", Array.from({ length: 20 }, (_, i) => i + 1)],
    ] as const)(`${mode}: carves the extra plane at %s`, async (geometry, size, expected) => {
        const input = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i + 1))]);
        const files = new Map([["/grid.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/grid.pgm", input);
        const args = ["/grid.pgm", "/grid.pgm", "/grid.pgm", "-size", "5x4", "xc:white", "/grid.pgm", "-combine",
            "-liquid-rescale", geometry, "-channel", "10", "-separate", "+channel",
            "-format", "%wx%h", "-write", "info:/size", "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            signal: new AbortController().signal,
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        const dimensions = mode === "command" || mode === "retained" ? await fs.readFile("/size") : files.get("/size")!;
        expect(Buffer.from(dimensions).toString()).toBe(size);
        expect([...output]).toEqual(expected);
    });
}
