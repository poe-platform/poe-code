import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 preserves explicit units without adding a resolution field.
const input = Buffer.concat([Buffer.from("P6\n8 5\n255\n"), Buffer.from(Array.from({ length: 120 }, (_, i) => (13 * i + 9) % 256))]);
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const setting of [["-units"], ["-set", "units"]]) {
        it.each(["PixelsPerCentimeter", "PixelsPerInch", "Undefined"])(`preserves %s without density via ${setting.join(" ")} (${mode})`, async units => {
            const files = new Map([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["/in.ppm", ...setting, units, "-write", "/first.miff", "/out.miff"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            for (const path of ["/first.miff", "/out.miff"]) {
                const bytes = mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!;
                const header = new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(26)));
                expect(header).toContain(`units=${units}\n`);
                expect(header).not.toContain("resolution=");
                const readArgs = [path, "-format", "%x|%y|%U", "info:"];
                const read = mode === "sync" ? runConvertCliSync(readArgs, files)
                    : await runConvertCli(readArgs, mode === "retained" || mode === "command" ? { filesystem: fs, cwd: "/" } : files);
                expect(read.exitCode).toBe(0);
                const [x, y, unit] = read.stdout.split("|");
                expect(unit).toBe(units);
                expect(Number(x)).toBeCloseTo(units === "PixelsPerCentimeter" ? 72 / 2.54 : 72, 10);
                expect(Number(y)).toBeCloseTo(Number(x), 10);
            }
        });
    }
}
