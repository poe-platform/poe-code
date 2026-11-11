import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const grouped of [false, true]) {
        it.each([
            { geometry: "2x0", borders: [2, 2] },
            { geometry: "%[fx:n]x0", borders: [2, 2] },
            { geometry: "%[fx:u[1].w/3]x0", borders: [2, 2] },
            { geometry: "%[fx:t+1]x0", borders: [1, 2] },
        ])(`${mode}, grouped=${grouped}: shaves $geometry using the current list`, async ({ geometry, borders }) => {
            const pixels = Uint8Array.from({ length: 72 }, (_, index) => index);
            const input = new Uint8Array([...new TextEncoder().encode("P6\n6 4\n255\n"), ...pixels]);
            for (const format of ["rgb", "info"]) {
                const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const argv = [...(grouped ? ["-size", "1x1", "xc:red", "("] : []),
                    "/in.ppm", grouped ? "/in.ppm" : "+clone", "-shave", geometry,
                    ...(grouped ? [")", "-delete", "0"] : []),
                    "-depth", "8", "-format", "%wx%h;", `${format}:${mode === "command" ? "-" : "/out"}`];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const stdout: number[] = [];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout.push(...bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                const output = mode === "command" ? Uint8Array.from(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
                if (format === "info") {
                    expect(new TextDecoder().decode(output)).toBe(borders.map(border => `${6 - border * 2}x4;`).join(""));
                } else {
                    const expected = borders.flatMap(border => Array.from({ length: 4 }, (_, row) =>
                        [...pixels.subarray((row * 6 + border) * 3, (row * 6 + 6 - border) * 3)]).flat());
                    expect(output).toEqual(Uint8Array.from(expected));
                }
            }
        });
    }
}
