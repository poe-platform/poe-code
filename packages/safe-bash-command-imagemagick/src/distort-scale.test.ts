import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// 6x4 RGB grid used for native ImageMagick 7.1.2-35 comparisons.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAH0lEQVR4nGOUdsmtRgWMf9X80YXucxiiCx18JYwmBADurCHtclsDfQAAAABJRU5ErkJggg==", "base64");
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function run(options: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-filter", "point", ...options, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        return { exitCode: result.exitCode, stderr, output: mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")! };
    }

    for (const operator of ["-distort", "+distort"]) {
        const distortion = [operator, "PerspectiveProjection", "1,0,0,0,1,0,0,0"];
        it.each(["0", "-0", "0.0", "broken", ""])(`rejects distort:scale=%s without replacing output (${operator}, ${mode})`, async scale => {
            const result = await run(["-define", `distort:scale=${scale}`, ...distortion]);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("distort:scale");
            expect(result.output).toEqual(keep);
        });

        it.each(["1", "-1"])(`preserves pixels and geometry with distort:scale=%s (${operator}, ${mode})`, async scale => {
            const baseline = await run(["-define", "distort:scale=1", ...distortion]);
            const result = await run(["-define", `distort:scale=${scale}`, ...distortion]);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            const output = decodeImage(result.output), expected = decodeImage(baseline.output);
            expect([output.width, output.height, output.virtualCanvas, output.data]).toEqual([expected.width, expected.height, expected.virtualCanvas, expected.data]);
            if (operator === "-distort") {
                expect([output.width, output.height, output.data]).toEqual([6, 4, decodeImage(input).data]);
            }
        });

        it(`resets or replaces an invalid scale before distortion (${operator}, ${mode})`, async () => {
            for (const reset of [["+define", "distort:scale"], ["-define", "distort:scale=-1"]]) {
                const result = await run(["-define", "distort:scale=broken", ...reset, ...distortion]);
                expect(result.exitCode).toBe(0);
                expect(result.stderr).toBe("");
            }
        });
    }

    it(`ignores an invalid scale when no subsequent distortion uses it (${mode})`, async () => {
        for (const preceding of [[], ["-distort", "PerspectiveProjection", "1,0,0,0,1,0,0,0"]]) {
            const result = await run([...preceding, "-define", "distort:scale=broken"]);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
        }
    });
}
