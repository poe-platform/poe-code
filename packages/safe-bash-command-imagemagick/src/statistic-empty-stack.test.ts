import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
// Decoded RGBA16 samples from ImageMagick 7.1.2-35.
const controls = {
    Maximum: "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff",
    Median: "03037070c8c8ffff515170709595ffff626250504646ffff626250504646ffff0b0b1f1ff0f0ffff",
};

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const statistic of ["Maximum", "Median"] as const) {
        it.each(["before", "after", "deleted"])(`${mode}: ${statistic}, input position: %s`, async position => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/byte.ppm", input);
            await fs.writeFile("/out.png", keep);
            const operator = ["-statistic", statistic, "3x1"];
            const argv = [
                ...(position === "before" ? ["/byte.ppm", ...operator]
                    : position === "after" ? [...operator, "/byte.ppm"]
                        : ["/byte.ppm", "+delete", ...operator, "/byte.ppm"]),
                "PNG64:/out.png",
            ];
            let stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            if (position === "before") {
                expect(result.exitCode, stderr).toBe(0);
                expect(stderr).toBe("");
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([5, 1]);
                expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(controls[statistic]);
            } else {
                expect(result.exitCode).toBe(1);
                expect(stderr).toContain("no images found for operation '-statistic'");
                expect(output).toEqual(keep);
            }
        });
    }
}
