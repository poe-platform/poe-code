import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI orders XYZ blue before red, HSL red before blue.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(["XYZ", "HSL"])(`orders %s histogram colors independently of pixel order (${mode})`, async colorspace => {
        const outputs: string[] = [];
        for (const pixels of ["255 0 0 255 0 0 0 0 255", "0 0 255 255 0 0 255 0 0"]) {
            const source = new TextEncoder().encode(`P3\n3 1\n255\n${pixels}\n`);
            const files = new Map([["/in.ppm", source]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", source);
            const argv = ["/in.ppm", "-colorspace", colorspace, "-format", "%c", "histogram:info:"];
            const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "sync" ? runConvertCliSync(argv, files)
                : mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { errors.push(bytes.slice()); } }
                }) : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : Buffer.concat(errors).toString()).toBe("");
            const stdout = "stdout" in result && typeof result.stdout === "string" ? result.stdout : Buffer.concat(chunks).toString();
            outputs.push(stdout);
            const rows = stdout.trim().split("\n");
            expect(rows.map(row => Number(row.slice(0, row.indexOf(":"))))).toEqual(colorspace === "XYZ" ? [1, 2] : [2, 1]);
            const channels = rows.map(row => row.slice(row.lastIndexOf("(") + 1, row.lastIndexOf(")")).split(",").map(value => Number.parseFloat(value)));
            const expected = colorspace === "XYZ" ? [[18.0481, 7.21926, 95.0532], [41.2396, 21.2586, 1.92972]] : [[0, 100, 50], [240, 100, 50]];
            for (const [index, values] of channels.entries()) {
                expect(values).toHaveLength(3);
                values.forEach((value, channel) => expect(value).toBeCloseTo(expected[index]![channel]!, 1));
            }
        }
        expect(outputs[0]).toBe(outputs[1]);
    });
}
