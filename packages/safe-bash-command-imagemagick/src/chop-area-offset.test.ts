import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 30 }, (_, i) => i * 8);
// Native ImageMagick 7.1.2-35 retains the page rectangle for scalar @ geometry with offsets.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "8@+1+1", page: "", format: "gray", expected: pixels, warns: true },
        { geometry: "3@+1+1", page: "", format: "gray", expected: pixels, warns: true },
        { geometry: "8@+1+1", page: "4x3-1+4", format: "info", expected: "2x2|1x1+0+1", warns: false },
        { geometry: "8@+1+1", page: "4x3-1+4", format: "gray", expected: Uint8Array.of(0xb0, 0xb8, 0xe0, 0xe8), warns: false },
        { geometry: "8@-1-1", page: "4x3-1+4", format: "gray", expected: Uint8Array.of(0xb0, 0xb8, 0xe0, 0xe8), warns: false },
        { geometry: "8@+1-1", page: "4x3-1+4", format: "gray", expected: Uint8Array.of(0xb0, 0xb8, 0xe0, 0xe8), warns: false },
        { geometry: "8x2@+1+1", page: "", format: "gray", expected: Uint8Array.of(0x00, 0x90, 0xc0), warns: false },
        { geometry: "2x3@", page: "", format: "gray", expected: Uint8Array.of(0xa0, 0xa8, 0xb0, 0xb8, 0xd0, 0xd8, 0xe0, 0xe8), warns: false },
    ])(`chops $geometry on page '$page' to $format (${mode})`, async ({ geometry, page, format, expected, warns }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n6 5\n255\n"), ...pixels]);
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["in.pgm", input], ["out", sentinel]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        await filesystem.writeFile("/out", sentinel);
        const args = ["in.pgm", ...(page ? ["-repage", page] : []), "-chop", geometry,
            ...(format === "info" ? ["-format", "%wx%h|%g"] : ["-depth", "8"]), `${format}:out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        expect.soft(output).toEqual(typeof expected === "string" ? new TextEncoder().encode(expected) : expected);
        expect("stderr" in result ? result.stderr : stderr).toBe(warns ? `magick: geometry does not contain image '${geometry}'\n` : "");
    });
}
