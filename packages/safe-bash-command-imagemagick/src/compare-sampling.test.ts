import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35: these 24x16 PPM inputs report RMSE 16011.7 (0.244323).
const inputs = [false, true].map(changed => Buffer.concat([
    Buffer.from("P6\n24 16\n255\n"),
    Uint8Array.from({ length: 24 * 16 * 3 }, (_, index) => {
        const x = Math.floor(index / 3) % 24, y = Math.floor(index / 72);
        return x * 13 + y * 29 + (index % 3) * 83 + (changed && (x + y) % 4 === 0 ? 97 : 0);
    })
]));

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    it(`honors JPEG sampling without changing compare metrics, ${mode}`, async () => {
        const files = new Map([["a.ppm", inputs[0]!], ["b.ppm", inputs[1]!]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const retained = mode === "retained" || mode === "compare" || mode === "magick";
        const run = async (argv: string[]) => {
            if (mode === "sync") return runCompareCliSync(argv, files);
            if (mode === "memory" || mode === "retained") return runCompareCli(argv, retained ? { filesystem: fs, cwd: "/" } : files);
            const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
            const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
            let stderr = "";
            const chunks: Uint8Array[] = [];
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
            return { ...result, stderr, stdoutBytes: Buffer.concat(chunks) };
        };
        for (const [options, sampling, quality] of [
            [[], "1x1,1x1,1x1", 92],
            [["-sampling-factor", "4:2:0"], "2x2,1x1,1x1", 92],
            [["-sampling-factor", "4:4:4"], "1x1,1x1,1x1", 92],
            [["-quality", "30", "-sampling-factor", "4:4:4"], "1x1,1x1,1x1", 30],
            [["-sampling-factor", "4:2:0", "-quality", "95"], "2x2,1x1,1x1", 95],
            [["-sampling-factor", "2x1,1x1,1x1"], "2x1,1x1,1x1", 92],
            [["-sampling-factor", "4:2:0", "+sampling-factor"], "1x1,1x1,1x1", 92],
            [["-quality", "30", "-sampling-factor", "4:4:4", "+sampling-factor"], "2x2,1x1,1x1", 30]
        ] as const) {
            for (const output of ["diff.jpg", "jpeg:-"]) {
                if (retained) await fs.writeFile("/diff.jpg", Buffer.from("KEEP"));
                else files.set("diff.jpg", Buffer.from("KEEP"));
                const result = await run(["-metric", "RMSE", ...options, "a.ppm", "b.ppm", output]);
                expect(result.exitCode, result.stderr).toBe(1);
                expect(result.stderr.trim()).toBe("16011.7 (0.244323)");
                const bytes = output === "jpeg:-" ? result.stdoutBytes! : retained ? await fs.readFile("/diff.jpg") : files.get("diff.jpg")!;
                expect(readImageMetadata(bytes)).toMatchObject({ width: 24, height: 16, quality, jpegSamplingFactor: sampling });
                expect(decodeImage(bytes).data).toHaveLength(24 * 16 * 4);
            }
        }
        expect(await run(["-sampling-factor"])).toMatchObject({ exitCode: 2, stderr: "compare: missing an argument for option '-sampling-factor'\n" });
        for (const [name, bytes] of [["a.ppm", inputs[0]!], ["b.ppm", inputs[1]!]] as const) {
            expect([...(retained ? await fs.readFile(`/${name}`) : files.get(name)!) ]).toEqual([...bytes]);
        }
    });
}
