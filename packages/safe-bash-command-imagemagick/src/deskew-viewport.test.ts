import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n32 16\n255\n"), Buffer.from(Array.from({ length: 32 * 16 }, (_, i) => {
    const x = i % 32, y = Math.floor(i / 32);
    return x >= 3 && x < 29 && [3, 4, 8, 9].includes(y - Math.floor(x / 7)) ? [10, 30, 60] : [240, 247, 252];
}).flat())]);

for (const mode of ["public", "buffered", "sync"] as const) {
    async function run(options: string[], output: string[]) {
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-deskew", "40%", ...output];
        if (mode !== "public") return mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, files);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            signal: new AbortController().signal, fs,
            stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = await createMagickCommand().execute(context);
        const stdoutBytes = Buffer.concat(chunks);
        return { ...result, stderr, stdout: stdoutBytes.toString(), stdoutBytes };
    }

    it.each(["define", "option", "artifact"])(`honors %s viewport geometry and sampling origin (${mode})`, async setting => {
        const options = setting === "define" ? ["-define", "distort:viewport=20x12+3+2"]
            : ["-set", `${setting}:distort:viewport`, "20x12+3+2"];
        const geometry = await run(options, ["-format", "%wx%h %g %[deskew:angle]", "info:"]);
        expect(geometry.exitCode, geometry.stderr).toBe(0);
        expect(geometry.stderr).toBe("");
        expect(geometry.stdout).toBe("20x12 20x12+3+2 -5.3558250428551908");
        const raster = await run(options, ["-depth", "8", "rgb:-"]);
        expect(raster.exitCode, raster.stderr).toBe(0);
        expect(raster.stderr).toBe("");
        expect(raster.stdoutBytes).toHaveLength(720);
        // Native ImageMagick 7.1.2-35 Q16-HDRI, including the shifted sampling origin.
        expect(createHash("sha256").update(raster.stdoutBytes!).digest("hex")).toBe("924f2be8fc5543d26eb567ad6690c9cd54c8cd15f26c6a9f807804900609041e");
    });

    it(`keeps default sampling after resetting the viewport (${mode})`, async () => {
        const result = await run(["-define", "distort:viewport=20x12+3+2", "+define", "distort:viewport"], ["-depth", "8", "rgb:-"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdoutBytes).toHaveLength(2205);
        expect(createHash("sha256").update(result.stdoutBytes!).digest("hex")).toBe("dd640e628393f0331549b1d6da16a19469316f822b32ad4ff14df79955af8f1c");
    });

    it(`captures the option before subsequent defines (${mode})`, async () => {
        const result = await run(["-define", "distort:viewport=20x12+3+2"],
            ["-define", "distort:viewport=2x2", "-format", "%wx%h %g", "info:"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("20x12 20x12+3+2");
    });

    it(`uses the image artifact before the option and captures settings at deskew (${mode})`, async () => {
        const result = await run(["-define", "distort:viewport=1x1", "-set", "artifact:distort:viewport", "20x12+3+2"],
            ["-define", "distort:viewport=2x2", "-format", "%wx%h %g", "info:"]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toBe("20x12 20x12+3+2");
    });
}
