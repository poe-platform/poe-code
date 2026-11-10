import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from("ff000000ff000000ffffee00991177245384", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI: an explicit density remains active after resampling.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const placement of ["before", "after", "none"] as const) {
        for (const repeats of [1, 2]) {
            for (const output of ["info", "rgb"] as const) {
                it(`preserves density ${placement} input through ${repeats} resample(s), ${output} (${mode})`, async () => {
                    const fs = new MemoryFileSystem();
                    await fs.writeFile("/im.ppm", input);
                    await fs.writeFile("/out", Buffer.from("KEEP"));
                    const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
                    const args = [
                        ...(placement === "before" ? ["-density", "72"] : []), "/im.ppm",
                        ...(placement === "after" ? ["-density", "72"] : []), "-filter", "point",
                        ...Array.from({ length: repeats }, () => ["-resample", "144"]).flat(),
                        ...(output === "info" ? ["-format", "%wx%h,%x,%y", "info:/out"] : ["-depth", "8", "rgb:/out"]),
                    ];
                    let result;
                    if (mode === "command") {
                        let stdout = "", stderr = "";
                        const argumentValues = createCommandArguments(args);
                        const status = await createMagickCommand().execute({
                            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                            stdin: (async function* () {})(), signal: new AbortController().signal,
                            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                        });
                        result = { ...status, stdout, stderr };
                    } else result = mode === "sync" ? runMagickCliSync(args, files)
                        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                    const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
                    const doubled = repeats === 2 && placement !== "none";
                    if (output === "info") {
                        expect(new TextDecoder().decode(bytes)).toBe(`${doubled ? "12x8" : "6x4"},${placement === "none" ? "144,144" : "72,72"}`);
                    } else {
                        expect(bytes.byteLength).toBe(doubled ? 288 : 72);
                        expect(createHash("sha256").update(bytes).digest("hex")).toBe(doubled
                            ? "eeaf116cee81b8e00f04499751fd7d97d4008898216a5c2139fbacafc65d6177"
                            : "d1ebfc840746c703e5a65cd3dcf470be292962aa8749d7395640e34c19af2298");
                    }
                });
            }
        }
    }
}

for (const mode of ["buffered", "retained"] as const) {
    it(`uses the density active at each resample (${mode})`, async () => {
        const fs = new MemoryFileSystem(), files = new Map([["/im.ppm", input]]);
        await fs.writeFile("/im.ppm", input);
        const result = await runMagickCli(["/im.ppm", "-density", "72", "-filter", "point",
            "-resample", "144", "-density", "144", "-resample", "144",
            "-format", "%wx%h,%x,%y", "info:"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toEqual({ exitCode: 0, stdout: "6x4,144,144", stderr: "" });
    });
}
