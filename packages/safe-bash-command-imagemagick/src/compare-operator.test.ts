import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Reference bytes from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "different inputs", args: ["xc:red", "xc:lime", "-compare"], hex: "f40018" },
    { name: "identical inputs", args: ["xc:red", "xc:red", "-compare"], hex: "ffcccc" },
    { name: "replaces the whole list", args: ["xc:red", "xc:lime", "xc:blue", "-compare"], hex: "f40018" },
    { name: "parenthesized list", args: ["xc:red", "(", "xc:lime", "xc:blue", "-compare", ")"], hex: "ff0000c13318" },
    { name: "fuzz tolerance", args: ["-fuzz", "100%", "xc:red", "xc:lime", "-compare"], hex: "ffcccc" },
    { name: "unequal sizes", args: ["-size", "2x1", "xc:red", "-size", "1x1", "xc:lime", "-compare"], hex: "f40018f40018" },
    { name: "preserves 16-bit reference samples", args: ["xc:#123456789abcffff", "xc:#123456789abcffff", "-compare"], depth: 16, hex: "d070de17ebbe" },
    { name: "detects one-quantum differences", args: ["xc:#123456789abcffff", "xc:#123556789abcffff", "-compare"], depth: 16, hex: "c532114b370a" },
    { name: "downstream pixel operator", args: ["xc:red", "xc:lime", "-compare", "-negate"], depth: 16, hex: "0b3effffe7e7" },
    { name: "multiple raster chunks", args: ["-size", "1025x1", "xc:red", "xc:lime", "-compare"], hex: "f40018".repeat(1025) },
    { name: "append control", args: ["xc:red", "xc:lime"], hex: "ff000000ff00" },
    { name: "single input", args: ["xc:red", "-compare"], error: "image sequence is required '-compare'" },
    { name: "empty list", args: ["-compare"], error: "no images found for operation '-compare'" }
];

for (const route of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${route}: -compare $name`, async ({ args, hex, error, depth = 8 }) => {
    const argv = [...args, "+append", "-depth", String(depth), "-endian", "MSB", "rgb:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    const diagnostics = "stderr" in result ? result.stderr : stderr;
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    if (error) {
        expect(result.exitCode).not.toBe(0);
        expect(diagnostics).toContain(error);
        expect(bytes.length).toBe(0);
    } else {
        expect(result.exitCode).toBe(0);
        expect(diagnostics).toBe("");
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    }
});
