import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native PNG64 with alpha samples 0, 17, 15000, and 65535.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABEAYAAACprNOOAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTk6Mjc6NTYrMDA6MDC6Cw1hAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE5OjI3OjU2KzAwOjAwy1a13QAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxOToyNzo1NiswMDowMJxDlAIAAAAkSURBVAjXY2R+EXljjgMDDAjy7Nh2ojjBqv1U8rw/tw8cTQcAof4MbzhsPwIAAAAASUVORK5CYII=", "base64");

for (const execution of ["command", "retained", "buffered", "sync"] as const) {
    for (const output of ["out.png", "PNG64:out.png"]) {
        for (const extract of [false, true]) {
            it.each(["on", "set", "activate"])(`${execution}: alpha %s preserves active 16-bit samples (${output}, extract=${extract})`, async mode => {
                const argv = ["in.png", "-alpha", mode, ...(extract ? ["-alpha", "extract"] : []), output];
                const files = new Map<string, Uint8Array>([["in.png", input]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const args = createCommandArguments(argv);
                let stderr = "";
                const result = execution === "sync" ? runMagickCliSync(argv, files)
                    : execution === "buffered" ? await runMagickCli(argv, files)
                    : execution === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
                    : await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    });
                expect(result.exitCode, stderr).toBe(0);
                expect(stderr).toBe("");
                const image = decodeImage(execution === "command" || execution === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
                const samples = [...decodeImage(input).data16!];
                expect(samples.filter((_, index) => index % 4 === 3)).toEqual([0, 17, 15000, 65535]);
                expect([...image.data16!]).toEqual(extract ? samples.map((_, index) => index % 4 === 3 ? 65535 : samples[index - index % 4 + 3]) : samples);
            });
        }
    }
}
