import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Three RGB pixels from the native ImageMagick 7.1.2-35 comparison.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADklEQVR4nGP4z8DAAMYADvsC/gkcFjQAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "sync", "retained", "stream", "command"] as const) {
    for (const kind of ["missed", "valid", "quiet", "explicit"] as const) {
        it(`${mode}: ${kind} input crop preserves pixels, page and diagnostics`, async () => {
            const files = new Map([["/pal.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/pal.png", input);
            const geometry = kind === "valid" ? "1x1+2+0" : "1x1+4+4";
            const args = [
                ...(kind === "quiet" ? ["-quiet"] : []),
                ...(kind === "explicit" ? ["/pal.png", "-crop", geometry] : [`/pal.png[${geometry}]`]),
                "PNG64:/output.png"
            ];
            let stderr = "";
            const sink = { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } };
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: sink
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : {
                    filesystem, cwd: "/", ...(mode === "stream" ? { stderr: sink } : {})
                });
            expect(result.exitCode).toBe(0);
            if ("stderr" in result) stderr += result.stderr;
            expect(stderr).toBe(kind === "valid" || kind === "quiet" ? ""
                : `magick: geometry does not contain image '${kind === "explicit" ? geometry : "/pal.png"}'\n`);
            const output = decodeImage(mode === "buffered" || mode === "sync"
                ? files.get("/output.png")! : await filesystem.readFile("/output.png"));
            expect(output).toMatchObject({ width: 1, height: 1,
                virtualCanvas: { width: 3, height: 1, x: kind === "valid" ? 2 : -1, y: kind === "valid" ? 0 : -1 } });
            expect(Array.from(output.data)).toEqual(kind === "valid" ? [0, 0, 255, 255] : [255, 255, 255, 0]);
            expect(Array.from(output.data16!)).toEqual(kind === "valid" ? [0, 0, 65535, 65535] : [65535, 65535, 65535, 0]);
        });
    }
}
