import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { name: "translucent Replace", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Replace", operation: "-composite", hex: "194877b0" },
    { name: "opaque Replace", inputs: ["-size", "1x1", "xc:#aa4433", "xc:#2468ac"], compose: "Replace", operation: "-composite", hex: "2468acff" },
    { name: "bright opaque Replace", inputs: ["-size", "1x1", "xc:#94daf5", "xc:#f6cc83"], compose: "Replace", operation: "-composite", hex: "f6cc83ff" },
    { name: "positioned Replace layers", inputs: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")", "-background", "#33553370"], compose: "Replace", operation: "-flatten", hex: "55221a80194877b0194877b0" },
    { name: "Over control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Over", operation: "-composite", hex: "3d6196d8" },
    { name: "Dst control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Dst", operation: "-composite", hex: "aa443380" },
    { name: "Copy control", inputs: ["-size", "1x1", "xc:#aa443380", "xc:#2468acb0"], compose: "Copy", operation: "-composite", hex: "2468acb0" }
])(`${mode}: $name`, async ({ inputs, compose, operation, hex }) => {
    const argv = [...inputs, "-compose", compose, operation, "-depth", "8", "rgba:-"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    const args = createCommandArguments(argv);
    let output: Uint8Array | undefined;
    if (mode === "command") {
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(data) { chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data); } },
            stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        output = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        output = result.stdoutBytes;
    }
    expect(Buffer.from(output ?? []).toString("hex")).toBe(hex);
});
