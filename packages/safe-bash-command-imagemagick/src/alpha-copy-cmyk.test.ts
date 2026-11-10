import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI output, with the generated alpha plane isolated.
for (const backend of ["command", "retained", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { space: "CMYK", alpha: "Copy", intensity: "", expected: "683e" },
            { space: "CMYK", alpha: "Copy", intensity: "Average", expected: "6555" },
            { space: "CMYK", alpha: "Shape", intensity: "", expected: "683e" },
            { space: "CMYK", alpha: "Shape", intensity: "Average", expected: "6555" },
            { space: "sRGB", alpha: "Copy", intensity: "", expected: "4c2d" },
            { space: "sRGB", alpha: "Copy", intensity: "Average", expected: "4da3" },
            { space: "sRGB", alpha: "Shape", intensity: "", expected: "4c2d" },
            { space: "sRGB", alpha: "Shape", intensity: "Average", expected: "4da3" },
            { space: "CMYK", alpha: "", intensity: "", expected: "6060" },
        ])(`${backend}, ${depth}-bit: $space alpha=$alpha intensity=$intensity`, async ({ space, alpha, intensity, expected }) => {
            const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = ["xc:#80402860", "-colorspace", space,
                ...(intensity ? ["-intensity", intensity] : []), ...(alpha ? ["-alpha", alpha] : []),
                "-channel", "A", "-separate", "+channel", "-depth", String(depth), "-endian", "MSB", "gray:out"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = backend === "sync" ? runMagickCliSync(argv, files)
                : backend === "buffered" ? await runMagickCli(argv, files)
                : backend === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                : await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = backend === "command" || backend === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output).toString("hex")).toBe(depth === 16 ? expected
                : Math.round(Number.parseInt(expected, 16) / 257).toString(16).padStart(2, "0"));
        });
    }
}
