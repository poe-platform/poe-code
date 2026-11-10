import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        { geometry: "30%+1+0", dimensions: "6x2", pixels: "ff0000".repeat(9) + "1234568badcffedcba" },
        { geometry: "3x1+0+0", dimensions: "6x2", pixels: "ff0000".repeat(9) + "1234568badcffedcba" },
        { geometry: "30%", dimensions: "4x1", pixels: "ff00001234568badcffedcba" },
        { geometry: "1+1+0", dimensions: "", pixels: "" },
    ])(`handles scalar percentage splice offsets (${mode}): $geometry`, async ({ geometry, dimensions, pixels }) => {
        for (const format of ["rgb", "info"]) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const argv = ["xc:#123456", "xc:#8badcf", "xc:#fedcba", "+append", "-background", "red",
                "-splice", geometry, "-depth", "8", "-format", "%wx%h", `${format}:${mode === "command" ? "-" : "/out"}`];
            const argumentValues = createCommandArguments(argv);
            const stdout: number[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(...chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(dimensions ? 0 : 1);
            const output = mode === "command" ? Uint8Array.from(stdout) : dimensions
                ? mode === "retained" ? await fs.readFile("/out") : files.get("/out")! : new Uint8Array();
            expect(format === "rgb" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output))
                .toBe(format === "rgb" ? pixels : dimensions);
            expect("stderr" in result ? result.stderr : stderr).toContain(dimensions ? "" : "invalid argument for option '-splice'");
        }
    });
}
