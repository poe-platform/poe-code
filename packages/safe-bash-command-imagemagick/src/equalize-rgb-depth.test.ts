import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: identical colors encoded as 8- and 16-bit PPM.
const rgb = [32, 80, 180, 144, 30, 45, 200, 210, 25, 32, 80, 180];
const cases = [
    { operators: ["-equalize"], depth: "16", expected: "0000bfffbfffbfff00000000ffffffff00000000bfffbfff" },
    { operators: ["-channel", "R", "-equalize", "+channel"], depth: "16", expected: "80005050b4b4bfff1e1e2d2dffffd2d2191980005050b4b4" },
    { operators: ["-equalize"], depth: "8", expected: "00bfbfbf0000ffff0000bfbf" },
    { operators: [], depth: "16", expected: "20205050b4b490901e1e2d2dc8c8d2d2191920205050b4b4" },
];

for (const sourceDepth of [8, 16]) {
    for (const mode of ["command", "buffered", "sync"] as const) {
        it.each(cases)(`preserves equalized RGB precision from ${sourceDepth}-bit input via ${mode}: $operators, depth=$depth`, async ({ operators, depth, expected }) => {
            const input = Buffer.concat([
                Buffer.from(`P6\n4 1\n${sourceDepth === 8 ? 255 : 65535}\n`),
                Buffer.from(sourceDepth === 8 ? rgb : rgb.flatMap(value => [value, value])),
            ]);
            const args = ["/input.ppm", ...operators, "-depth", depth, "-endian", "MSB", "rgb:-"];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            if (mode === "command") {
                const fs = createMemoryFileSystem();
                await fs.writeFile("/input.ppm", input);
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async chunk => { stdout.push(chunk.slice()); } },
                    stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
                });
                expect(result.exitCode).toBe(0);
                expect(stderr).toBe("");
            } else {
                const files = new Map([["/input.ppm", input]]);
                const result = mode === "sync" ? runConvertCliSync([...args.slice(0, -1), "rgb:/out.rgb"], files)
                    : await runConvertCli([...args.slice(0, -1), "rgb:/out.rgb"], files);
                expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
                stdout.push(files.get("/out.rgb")!);
            }
            expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
        });
    }
}
