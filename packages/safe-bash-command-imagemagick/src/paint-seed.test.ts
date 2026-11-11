import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGB8 rasters (hex or SHA-256) from ImageMagick 7.1.2-35 Q16-HDRI, one thread.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { width: 0, height: 0, radius: "1", seed: "2", method: "random", expected: "d0c0a0d0c0a0505860" },
        { width: 0, height: 0, radius: "1", seed: "3", method: "random", expected: "505860505860505860" },
        { width: 0, height: 0, radius: "1", seed: "2", method: "edge", expected: "505860505860d0c0a0" },
        { width: 5, height: 3, radius: "1", seed: "42", method: "random", expected: "f457472e76a508dedf62eb0410b5acf3e9cf7b4b1fa9e733df0275fdeffee50a" },
        { width: 513, height: 2, radius: "2", seed: "3", method: "random", expected: "bdaf0813bd937f16ac576b2c85a2c5f9f41eb66f4dc61a62d2a6409d6dc4d18c" },
        { width: 5, height: 3, radius: "1", seed: "0", method: "random", expected: "89d91398c977f41fd08fefa1ca8044efc2a4eb2be3cf04f6aa8cb87fc9511676" },
        { width: 5, height: 3, radius: "2", seed: "-2", method: "random", expected: "e13f9d26ebe2d12f8621736572a117979fbb0673f3c091d76fc5ba7ce6689a8b" },
        { width: 5, height: 3, radius: "1", seed: "9007199254740993", method: "random", expected: "77a5ea7c537e292836e4455d72a4b398124494b689c386fcdcddd325ce325b61" },
    ])(`${mode}: repeats paint $radius on $width x $height with seed $seed and $method virtual pixels`, async ({ width, height, radius, seed, method, expected }) => {
        for (let repeat = 0; repeat < 3; repeat++) {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            if (width) {
                const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),
                    Buffer.from(Array.from({ length: width * height * 3 }, (_, i) => (i * 37 + 19) % 256))]);
                files.set("/in.ppm", input);
                await fs.writeFile("/in.ppm", input);
            }
            const inputs = width ? ["/in.ppm"] : ["xc:#505860", "xc:#789080", "xc:#d0c0a0", "+append", "-colorspace", "sRGB"];
            const args = ["-limit", "thread", "1", ...inputs, "-seed", seed, "-virtual-pixel", method,
                "-paint", radius, "-seed", "99", "-depth", "8", "rgb:-"];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
            expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = Buffer.concat(stdout);
            expect(width ? createHash("sha256").update(output).digest("hex") : output.toString("hex")).toBe(expected);
        }
    });
}
