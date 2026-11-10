import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: zero ratio axes do not insert a band.
const cases = [
    [":2", 3, 4], ["0:2", 3, 4], ["2:0", 6, 2], ["0:0", 3, 4],
    ["2:1", 6, 4], ["0x2", 3, 4], ["3x0", 6, 2],
] as const;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["info", "PNG24"] as const) {
        it.each(cases)(`preserves zero splice axes for %s (${mode}, ${format})`, async (geometry, width, height) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = ["-size", "3x2", "xc:red", "-splice", geometry, "-format", "%wx%h", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe(`${width}x${height}`);
            } else {
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([width, height]);
                const expected: number[] = [];
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    expected.push(...(x < width - 3 || y < height - 2 ? [255, 255, 255, 255] : [255, 0, 0, 255]));
                }
                expect(image.data).toEqual(Uint8Array.from(expected));
            }
        });
    }
}
