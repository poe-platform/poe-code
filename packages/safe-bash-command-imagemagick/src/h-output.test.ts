import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick Q16-HDRI emits these PNM bytes inside MagickImage[].
for (const unique of [false, true]) {
    const pixels = unique ? [255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255] : [255, 255, 0, 0, 0, 0];
    const expected = new Uint8Array([...new TextEncoder().encode(`P6\n${unique ? 2 : 1} 1\n65535\n`), ...pixels]);
    for (const mode of ["command", "buffered", "sync", "retained"] as const) {
        for (const write of [false, true]) for (const output of ["h:-", "H:/image.bin", "/image.h"]) {
            it(`writes a C byte array (${mode}, ${output}, write=${write}, unique=${unique})`, async () => {
                const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                const args = ["xc:red", ...(unique ? ["xc:blue", "+append", "-unique-colors"] : []), ...(write ? ["-write", output, "null:"] : [output])];
                let stdout = "", stderr = "";
                if (mode === "command") {
                    const result = await createMagickCommand().execute({
                        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                        stdin: (async function* () {})(),
                        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    });
                    expect(result.exitCode).toBe(0);
                } else {
                    const result = mode === "sync" ? runConvertCliSync(args, files)
                        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                    expect(result.exitCode).toBe(0);
                    stdout = result.stdoutBytes ? new TextDecoder().decode(result.stdoutBytes) : result.stdout;
                    stderr = result.stderr;
                }
                expect(stderr).toBe("");
                const buffered = mode === "sync" || mode === "buffered";
                const path = output === "/image.h" ? output : "/image.bin";
                const text = output === "h:-" ? stdout
                    : new TextDecoder().decode(buffered ? files.get(path) : await fs.readFile(path));
                expect(text).toMatch(/static const unsigned char\s+MagickImage\[\]\s*=\s*\{/);
                expect(text.trimEnd().endsWith("};")).toBe(true);
                const bytes = Uint8Array.from([...text.matchAll(/0x([0-9a-fA-F]{2})/g)], match => Number.parseInt(match[1]!, 16));
                expect(bytes).toEqual(expected);
            });
        }
    }
}
