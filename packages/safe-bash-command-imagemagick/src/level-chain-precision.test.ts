import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGBA8 samples from the native ImageMagick 7.1.2-35 Q16-HDRI reproduction.
const gray = [0, 16, 63, 64, 65, 100, 127, 128, 129, 165, 190, 191, 192, 200, 240, 255];
const alpha = [45, 98, 151, 204, 1, 54, 107, 160, 213, 10, 63, 116, 169, 222, 19, 72];
const pixels = Uint8Array.from(gray.flatMap((value, index) => [value, value, value, alpha[index]!]));

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        {
            name: "chained inverse levels",
            stages: [["+level", "25%,75%", "-level", "25%,75%"]],
            gray, alpha
        },
        {
            name: "single +level",
            stages: [["+level", "25%,75%"]],
            gray: [64, 72, 95, 96, 96, 114, 127, 128, 128, 146, 159, 159, 160, 164, 184, 191],
            alpha: [86, 113, 139, 166, 64, 91, 117, 144, 170, 69, 95, 122, 148, 175, 73, 100]
        },
        {
            name: "single -level",
            stages: [["-level", "25%,75%"]],
            gray: [0, 0, 0, 1, 3, 73, 127, 129, 131, 203, 253, 255, 255, 255, 255, 255],
            alpha: [0, 69, 175, 255, 0, 0, 87, 193, 255, 0, 0, 105, 211, 255, 0, 17]
        },
        {
            name: "levels separated by PNG32 encoding",
            stages: [["+level", "25%,75%"], ["-level", "25%,75%"]],
            gray: [1, 17, 63, 65, 65, 101, 127, 129, 129, 165, 191, 191, 193, 201, 241, 255],
            alpha: [45, 99, 151, 205, 1, 55, 107, 161, 213, 11, 63, 117, 169, 223, 19, 73]
        }
    ])(`preserves RGBA8 output for $name (${mode})`, async ({ stages, gray, alpha }) => {
        const input = encodeImage({ width: 8, height: 2, data: pixels, format: "png", space: "srgb",
            channels: 4, density: 72, hasAlpha: true, depth: "uchar" }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        for (const [index, stage] of stages.entries()) {
            const argv = [index === 0 ? "/in.png" : "/out.png", ...stage, "PNG32:/out.png"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
        }
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect(output.depth).toBe("uchar");
        expect([...output.data]).toEqual(gray.flatMap((value, index) => [value, value, value, alpha[index]!]));
        expect(mode === "sync" || mode === "buffered" ? files.get("/in.png") : await fs.readFile("/in.png")).toEqual(input);
    });
}
