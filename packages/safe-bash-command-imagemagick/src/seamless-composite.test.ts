import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, compared as 8-bit RGBA bytes.
// Additional transparent-source references checked with 7.1.2-31 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "translucent composite", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "SeamlessBlend", operation: ["-composite"], expected: "aa4433c0" },
        { name: "opaque composite", inputs: ["-size", "1x1", "xc:#aa4433", "xc:#2468ac"], compose: "SeamlessBlend", operation: ["-composite"], expected: "aa4433ff" },
        { name: "bright composite", inputs: ["-size", "1x1", "xc:#94daf5", "xc:#f6cc83"], compose: "SeamlessBlend", operation: ["-composite"], expected: "94daf5ff" },
        { name: "offset flatten", inputs: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")", "-background", "#33553370"], compose: "SeamlessBlend", operation: ["-flatten"], expected: "335533af335533e6335533e6" },
        { name: "Over control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Over", operation: ["-composite"], expected: "3d6196d8" },
        { name: "Dst control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Dst", operation: ["-composite"], expected: "aa443380" },
        { name: "spatial SeamlessBlend", inputs: ["-size", "5x5", "gradient:#3868cc-#da823d", "(", "-size", "3x3", "xc:#e72731", "-fill", "#1ec679", "-draw", "point 1,1", ")", "-geometry", "+1+1"], compose: "SeamlessBlend", operation: ["-composite"], expected: "3868ccff3868ccff3868ccff3868ccff3868ccff616fa8ff9f637dff9f637dff9f637dff616fa8ff897585ff9f637dff00ffc5ff9f637dff897585ffb27c61ff9f637dff9f637dff9f637dffb27c61ffda823dffda823dffda823dffda823dffda823dff" },
        { name: "spatial Over", inputs: ["-size", "5x5", "gradient:#3868cc-#da823d", "(", "-size", "3x3", "xc:#e72731", "-fill", "#1ec679", "-draw", "point 1,1", ")", "-geometry", "+1+1"], compose: "Over", operation: ["-composite"], expected: "3868ccff3868ccff3868ccff3868ccff3868ccff616fa8ffe72731ffe72731ffe72731ff616fa8ff897585ffe72731ff1ec679ffe72731ff897585ffb27c61ffe72731ffe72731ffe72731ffb27c61ffda823dffda823dffda823dffda823dffda823dff" },
        { name: "spatial Dst", inputs: ["-size", "5x5", "gradient:#3868cc-#da823d", "(", "-size", "3x3", "xc:#e72731", "-fill", "#1ec679", "-draw", "point 1,1", ")", "-geometry", "+1+1"], compose: "Dst", operation: ["-composite"], expected: "3868ccff3868ccff3868ccff3868ccff3868ccff616fa8ff616fa8ff616fa8ff616fa8ff616fa8ff897585ff897585ff897585ff897585ff897585ffb27c61ffb27c61ffb27c61ffb27c61ffb27c61ffda823dffda823dffda823dffda823dffda823dff" },
        { name: "transparent source boundary", inputs: ["-size", "3x3", "gradient:#3868cc-#da823d", "(", "-size", "3x3", "xc:none", "-fill", "#e72731", "-draw", "point 1,1", ")"], compose: "SeamlessBlend", operation: ["-composite"], expected: "3868ccff3868ccff3868ccff897585ffff9cb6ff897585ffda823dffda823dffda823dff" },
        { name: "transparent relaxation", inputs: ["-size", "5x5", "gradient:#3868cc-#da823d", "(", "-size", "5x5", "xc:none", "-fill", "#e72731", "-draw", "rectangle 1,1 3,3", ")"], compose: "SeamlessBlend", operation: ["-composite"], expected: "3868ccff3868ccff3868ccff3868ccff3868ccff616fa8ffff90c7ffff8ebaffff90c7ff616fa8ff897585ffff91a8ffff8ea4ffff91a8ff897585ffb27c61ffff9a92ffff9596ffff9a92ffb27c61ffda823dffda823dffda823dffda823dffda823dff" },
    ])(`${mode}: $name`, async ({ inputs, compose, operation, expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), stdout: Uint8Array[] = [];
        let stderr = "";
        const argv = [...inputs, "-compose", compose, ...operation, "-depth", "8", "rgba:-"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.alloc(0);
        expect(output.toString("hex")).toBe(expected);
    });
}
