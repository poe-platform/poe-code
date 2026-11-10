import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: decoded RGBA hashes, without intermediate encoding.
const cases = [
    {
        name: "RGB",
        input: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC",
        hashes: ["0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7", "39dc8e035c9681050f9359212470dd3227b6cd43c0c290792d44003684ff96bc"],
    },
    {
        name: "RGBA",
        input: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAYAAAD+Bd/7AAAAHElEQVR4nGNkYGBgULR2dseFmUS5NYXx4cGgAAANORS26MpKWAAAAABJRU5ErkJggg==",
        hashes: ["5e2a97aa97d61efd0690cc4e7a7e04c509f6e8274bbcf2828b2d2d5018c06cba", "561986131c9ce6cf54271f7619fc87f0b62752f0f7c841ce58052bda56320788"],
    },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const count of [1, 2]) {
        it.each(cases)(`${mode}: ${count} range thresholds preserve $name precision`, async ({ name, input, hashes }) => {
            const files = new Map<string, Uint8Array>([
                ["/in.png", Buffer.from(input, "base64")],
                ["/out.png", new TextEncoder().encode("KEEP")],
            ]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["/in.png", ...Array.from({ length: count }, () => ["-range-threshold", "10,30,60,90%"]).flat(), "PNG32:/out.png"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            const output = decodeImage(bytes);
            expect([output.width, output.height]).toEqual([8, 6]);
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(hashes[count - 1]);
            if (count === 2) expect([...output.data.slice(12, 16)]).toEqual([17, 17, 17, name === "RGB" ? 255 : 17]);
        });
    }
}
