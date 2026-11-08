import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const rgb = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwgSLRt8gm+nAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA4VDE4OjQ1OjI3KzAwOjAwqYWrDQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOFQxODo0NToyNyswMDowMNjYE7EAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDhUMTg6NDU6MjcrMDA6MDCPzTJuAAAAEGNhTnYAAAABAAAAAQAAAAAAAAAAmdvqagAAAA9JREFUCNdjEDIJW332PQAHWQMEqQIPzQAAAABJRU5ErkJggg=="), char => char.charCodeAt(0));
const alpha = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwgSLRt8gm+nAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA4VDE4OjQ1OjI3KzAwOjAwqYWrDQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOFQxODo0NToyNyswMDowMNjYE7EAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDhUMTg6NDU6MjcrMDA6MDCPzTJuAAAAEGNhTnYAAAABAAAAAQAAAAAAAAAAmdvqagAAABFJREFUCNdj+M/A8J9LRK4BAA4cAruSESPIAAAAAElFTkSuQmCC"), char => char.charCodeAt(0));

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { bytes: rgb, options: [], space: "srgb", tuples: ["(18,52,86)", "(171,205,239)"] },
        { bytes: alpha, options: ["-alpha", "off"], space: "srgb", tuples: ["(255,0,0)", "(10,20,30)"] },
        { bytes: rgb, options: ["-colorspace", "Gray"], space: "gray", tuples: ["(47)", "(200)"] },
        { bytes: alpha, options: ["-colorspace", "Gray"], space: "graya", tuples: ["(54,255)", "(19,128)"] },
        ...[[], ["-depth", "8"]].map(options => ({ bytes: alpha, options, space: "srgba", tuples: ["(255,0,0,255)", "(10,20,30,128)"] })),
    ])(`preserves $space channels through ${mode}`, async ({ bytes, options, space, tuples }) => {
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const args = ["/in.png", ...options, "txt:-"];
        let stdout = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { write: async () => {} },
        });
        expect(result.exitCode).toBe(0);
        const lines = ("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout).trim().split("\n");
        expect(lines[0]).toBe(`# ImageMagick pixel enumeration: 2,1,0,255,${space}`);
        if (space === "srgba") expect(lines.slice(1)).toEqual([
            "0,0: (255,0,0,255)  #FF0000FF  red",
            "1,0: (10,20,30,128)  #0A141E80  srgba(10,20,30,0.501961)",
        ]);
        tuples.forEach((tuple, x) => expect(lines[x + 1]?.startsWith(`${x},0: ${tuple}  #`)).toBe(true));
    });
}
