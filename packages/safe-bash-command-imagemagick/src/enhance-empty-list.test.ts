import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference pixels and operation ordering.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/out.raw"]) {
        it.each([
            { name: "before input", args: ["-enhance", "/in.ppm"], expected: undefined },
            { name: "before missing input", args: ["-enhance", "/missing.ppm"], expected: undefined },
            { name: "after delete", args: ["/in.ppm", "+delete", "-enhance", "/in.ppm"], expected: undefined },
            { name: "empty group", args: ["/in.ppm", "(", "-enhance", "/in.ppm", ")"], expected: undefined },
            { name: "after input", args: ["/in.ppm", "-enhance"], expected: "485c7a4b5f7d" },
            { name: "without enhance", args: ["/in.ppm"], expected: "465a784d617f" },
        ])(`${mode}: enhance $name writing ${destination}`, async ({ args, expected }) => {
            const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([70, 90, 120, 77, 97, 127])]);
            const original = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.ppm", input], ["/out.raw", original]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = [...args, "-depth", "8", `rgb:${destination}`];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            if ("stderr" in result) stderr = String(result.stderr);
            const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? result.stdoutBytes : Buffer.concat(chunks);
            const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
            expect.soft(result.exitCode, stderr).toBe(expected === undefined ? 1 : 0);
            if (expected === undefined) {
                expect.soft(stderr).toContain("no images found for operation '-enhance'");
                expect.soft(stdout.byteLength).toBe(0);
                if ("stdout" in result) expect.soft(result.stdout).toBe("");
                expect.soft(output).toEqual(original);
            } else {
                expect(stderr).toBe("");
                expect(Buffer.from(destination === "-" ? stdout : output).toString("hex")).toBe(expected);
            }
        });
    }
}
