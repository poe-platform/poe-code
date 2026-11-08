import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const rgb = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwgSLRt8gm+nAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA4VDE4OjQ1OjI3KzAwOjAwqYWrDQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wOFQxODo0NToyNyswMDowMNjYE7EAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDhUMTg6NDU6MjcrMDA6MDCPzTJuAAAAEGNhTnYAAAABAAAAAQAAAAAAAAAAmdvqagAAAA9JREFUCNdjEDIJW332PQAHWQMEqQIPzQAAAABJRU5ErkJggg=="), char => char.charCodeAt(0));
for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { options: ["-depth", "1"], maximum: 255, tuples: ["(0,0,0)  #000000", "(255,255,255)  #FFFFFF"] },
        { options: ["-depth", "4"], maximum: 255, tuples: ["(17,51,85)  #113355", "(170,204,238)  #AACCEE"] },
        { options: ["-depth", "16"], maximum: 65535, tuples: ["(4626,13364,22102)  #121234345656", "(43947,52685,61423)  #ABABCDCDEFEF"] },
    ])(`honors $options sample depth through ${mode}`, async ({ options, maximum, tuples }) => {
        const files = new Map([["/in.png", rgb]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", rgb);
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
        expect(lines[0]).toBe(`# ImageMagick pixel enumeration: 2,1,0,${maximum},srgb`);
        tuples.forEach((tuple, x) => expect(lines[x + 1]?.startsWith(`${x},0: ${tuple}  `)).toBe(true));
    });
}
