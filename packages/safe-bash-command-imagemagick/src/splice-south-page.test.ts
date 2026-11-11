import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7: zero-height bands use the virtual page for gravity placement.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const gravity of ["SouthEast", "South", "SouthWest"]) {
        it.each([
            { page: "2x2", offset: "-2", valid: true },
            { page: "2x2", offset: "-3", valid: true },
            { page: "2x2", offset: "-4", valid: false },
            { page: "2x3", offset: "-3", valid: true },
            { page: "2x3", offset: "-4", valid: false },
            { page: "2x1", offset: "-2", valid: false },
            { page: "8x1", offset: "-2", valid: false },
            { page: "2x2", offset: "+0", valid: true },
        ])(`places column splice on page $page with offset $offset (${mode}, ${gravity})`, async ({ page, offset, valid }) => {
            for (const format of ["rgb", "info"]) {
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const argv = ["-size", "2x1", "xc:navy", "-background", "red", "-repage", page,
                    "-gravity", gravity, "-splice", `1x0+0${offset}`, "-depth", "8", "-format", "%wx%h %g",
                    `${format}:${mode === "command" ? "-" : "/out"}`];
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
                expect(result.exitCode).toBe(valid ? 0 : 1);
                const error = "stderr" in result ? result.stderr : stderr;
                if (!valid) {
                    expect(error).toContain("pixels are not authentic");
                    expect("stdout" in result ? result.stdout : new TextDecoder().decode(Uint8Array.from(stdout))).toBe("");
                    continue;
                }
                expect(error).toBe("");
                const output = mode === "command" ? Uint8Array.from(stdout)
                    : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                expect(format === "rgb" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output))
                    .toBe(format === "rgb" ? gravity === "SouthEast" ? "000080000080ff0000" : "ff0000000080000080"
                        : `3x1 3x${page.slice(2)}+0+0`);
            }
        });
    }
}
