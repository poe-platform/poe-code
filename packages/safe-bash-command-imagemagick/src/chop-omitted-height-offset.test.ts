import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2: an empty height before offsets uses the image height.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["3x+1+1", "info", "3x1"],
        ["3x+1+1", "gray", "002028"],
        ["3x+0+2", "info", "3x2"],
        ["3x+1-1", "info", "3x1"],
        ["3x5+1+1", "gray", "002028"],
        ["3x0+1+1", "gray", "00202830505860808890b0b8c0e0e8"],
        ["3x", "info", "3x5"],
    ] as const)(`resolves chop %s for %s output (${mode})`, async (geometry, format, expected) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n6 5\n255\n"), ...Array.from({ length: 30 }, (_, i) => i * 8)]);
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pgm", input], ["out", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        await filesystem.writeFile("/out", sentinel);
        const args = ["in.pgm", "-chop", geometry, ...(format === "info" ? ["-format", "%wx%h"] : ["-depth", "8"]), `${format}:out`];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(format === "info" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(expected);
    });
}
