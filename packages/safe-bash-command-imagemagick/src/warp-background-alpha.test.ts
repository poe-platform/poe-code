import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick: translucent backgrounds activate alpha even with edge virtual pixels.
const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256))]);
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const background of ["none", "#ff000080", "white"]) {
        for (const operation of [[], ["-swirl", "135"], ["-swirl", "1.5"], ["-implode", "1.5"]]) {
            it(`${mode}: ${background} ${operation.join(" ")} alpha traits and negate`, async () => {
                const active = background !== "white" && operation.length > 0;
                for (const format of [true, false]) {
                    const fs = new MemoryFileSystem(), files = new Map([["/input.ppm", input]]);
                    await fs.writeFile("/input.ppm", input);
                    const destination = mode === "command" ? "-" : "/out";
                    const argv = ["/input.ppm", "-background", background, ...operation,
                        ...(format ? ["-format", "%A:%[opaque]", `info:${destination}`]
                            : ["-channel", "A", "-negate", "+channel", "-depth", "8", `rgba:${destination}`])];
                    const args = createCommandArguments(argv);
                    const chunks: Uint8Array[] = [];
                    let stderr = "";
                    const result = mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(bytes) { chunks.push(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                    }) : mode === "sync" ? runMagickCliSync(argv, files)
                        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result.exitCode).toBe(0);
                    expect("stderr" in result ? result.stderr : stderr).toBe("");
                    const output = mode === "command" ? Buffer.concat(chunks)
                        : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
                    if (format) expect(output.toString()).toBe(`${active ? "Blend" : "Undefined"}:True`);
                    else {
                        expect(output.length).toBe(7 * 5 * 4);
                        expect(new Set(output.filter((_, i) => i % 4 === 3))).toEqual(new Set([active ? 0 : 255]));
                    }
                }
            });
        }
    }
}
