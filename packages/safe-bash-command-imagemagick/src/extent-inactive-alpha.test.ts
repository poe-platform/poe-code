import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: disabled alpha makes source pixels opaque, including on transparent padding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const evaluate of [false, true]) for (const depth of [8, 16]) {
        it.each([
            { alpha: "Off", background: "white", operation: "-extent", geometry: "1x1", expected: "804020ff" },
            { alpha: "Off", background: "none", operation: "-extent", geometry: "1x1", expected: "804020ff" },
            { alpha: "Off", background: "none", operation: "-extent", geometry: "2x1", expected: "804020ff00000000" },
            { alpha: "Off", background: "white", operation: "-extent", geometry: "2x1", expected: "804020ffffffffff" },
            { alpha: "Off", background: "white", operation: "-border", geometry: "1x0", expected: "ffffffff804020ffffffffff" },
            { alpha: "On", background: "none", operation: "-extent", geometry: "2x1", expected: "8040206000000000" },
        ])(`${mode}: $alpha $operation $geometry on $background (evaluate=${evaluate}, depth=${depth})`, async ({ alpha, background, operation, geometry, expected }) => {
            const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("out")!);
            const argv = ["xc:#80402060", "-alpha", alpha, ...(evaluate ? ["-evaluate", "Add", "0"] : []),
                "-background", background, "-bordercolor", background, operation, geometry, "-depth", String(depth), "rgba:out"];
            const argumentValues = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            const bytes = Array.from(Buffer.from(expected, "hex"));
            expect(Array.from(output)).toEqual(depth === 16 ? bytes.flatMap(value => [value, value]) : bytes);
        });
    }
}
