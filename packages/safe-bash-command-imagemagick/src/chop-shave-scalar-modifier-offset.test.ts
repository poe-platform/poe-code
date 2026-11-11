import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves this 4x3 raster and warns for scalar modifiers before offsets.
const pixels = Uint8Array.from({ length: 36 }, (_, index) => index * 7);
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const operation of ["-chop", "-shave"]) {
        it.each(["1!+1+1", "1%+1+1", "1<+1+1", "1>+1+1", "1^+1+1", "1#+1+1", "1x1+1+1", "1+1+1"])(
            `handles ${operation} %s without losing warning output (${mode})`, async geometry => {
                const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...pixels]);
                const files = new Map([["/grid.ppm", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/grid.ppm", input);
                const argv = ["/grid.ppm", operation, geometry, "-depth", "8", "rgb:-"];
                const args = createCommandArguments(argv);
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                const invalid = geometry === "1+1+1";
                const explicit = geometry === "1x1+1+1";
                expect(result.exitCode).toBe(invalid ? 1 : 0);
                expect("stderr" in result ? result.stderr : stderr).toBe(invalid
                    ? `magick: invalid argument for option '${operation}': ${geometry}\n`
                    : explicit ? "" : `magick: geometry does not contain image '${operation === "-shave" ? "/grid.ppm" : geometry}'\n`);
                const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
                const expected = invalid ? new Uint8Array() : explicit
                    ? operation === "-shave" ? pixels.slice(15, 21)
                        : Uint8Array.from([0, 2, 3, 8, 10, 11].flatMap(index => [...pixels.slice(index * 3, index * 3 + 3)]))
                    : pixels;
                expect(Buffer.from(output)).toEqual(Buffer.from(expected));
            });
    }
}
