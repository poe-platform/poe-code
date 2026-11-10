import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, parseMagickGeometry, runMagickCli, runMagickCliSync } from "./index.js";

it.each([
    { geometry: "1e+0x2", width: 1, height: 2, x: 0, y: 0, hasOffset: false },
    { geometry: "1e-0x2", width: 1, height: 2, x: 0, y: 0, hasOffset: false },
    { geometry: "1x1e-1", width: 1, height: 0.1, x: 0, y: 0, hasOffset: false },
    { geometry: "1E+0x2E-1+1e+0-2e-1", width: 1, height: 0.2, x: 1, y: -0.2, hasOffset: true },
    { geometry: "1e+0x2+0x2-0x1", width: 1, height: 2, x: 2, y: -1, hasOffset: true },
    { geometry: "1e+0x2+1+", width: 1, height: 2, x: 1, y: 0, hasOffset: true },
])("keeps exponent signs within their geometry numbers: $geometry", ({ geometry, ...expected }) => {
    expect(parseMagickGeometry(geometry)).toMatchObject(expected);
});

// ImageMagick 7.1.2-35 Q16-HDRI: signed exponents preserve dimensions before rounding.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operation: "-splice", geometry: "1e+0x2", expected: "4x4" },
        { operation: "-splice", geometry: "1e-0x2", expected: "4x4" },
        { operation: "-splice", geometry: "1e0x2", expected: "4x4" },
        { operation: "-splice", geometry: "1x2", expected: "4x4" },
        { operation: "-chop", geometry: "1x1e-1", expected: "2x2" },
        { operation: "-chop", geometry: "1x2e-1", expected: "2x2" },
        { operation: "-chop", geometry: "1x0", expected: "2x2" },
    ])(`matches native dimensions for $operation $geometry (${mode})`, async ({ operation, geometry, expected }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        await filesystem.writeFile("/out", files.get("out")!);
        const args = ["-size", "3x2", "xc:red", operation, geometry, "-format", "%wx%h", "info:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
