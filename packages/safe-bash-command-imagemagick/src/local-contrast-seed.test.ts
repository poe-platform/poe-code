import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, Linux: fixed-seed RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["7", "random", "0d1a2884a2bf"],
        ["123", "random", "0f1d2c87a4c2"],
        ["7", "edge", "0d1a2887a4c2"],
    ])(`repeats native seeded local contrast via ${mode}: %s %s`, async (seed, virtualPixel, expected) => {
        for (let repeat = 0; repeat < 12; repeat++) {
            const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["-seed", seed, "/in.ppm", "-virtual-pixel", virtualPixel, "-local-contrast", "250x50", "-depth", "8", "rgb:/out"];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
