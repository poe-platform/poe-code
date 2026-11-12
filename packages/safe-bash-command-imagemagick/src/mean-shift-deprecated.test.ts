import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects +mean-shift without consuming a geometry.
const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(
    Array.from({ length: 35 }, (_, i) => [0, 1, 2].map(c => (i % 7 * 31 + Math.floor(i / 7) * 47 + c * 53) % 256)).flat()
)]);
const rgba = "1e5388ff33689dff4a7fb4ff5d92c7ff5c91c6ffafe419ffb5ea1fff386da2ff457aafff5388bdff4a7fb4ffb3e81dffafe419ffe91e53ff6095caff6095cafface116ffabe015ffea1f54ffe91e53ff487db2ff6196cbfface116ffe81d52ffe2174cff497eb3ff3f74a9ff4479aeffbaef24ffe81d52ffe81d52ff396ea3ff386da2ff497eb3ff588dc2ff";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: ["+mean-shift"], position: 2 },
        { options: ["+mean-shift", "5x5+55%"], position: 2 },
        { options: ["(", "+mean-shift", ")"], position: 3 },
        { options: ["-depth", "8", "(", "+mean-shift", "5x5+55%", ")"], position: 5 },
        { options: ["-mean-shift", "5x5+55%"], position: 0 }
    ])(`${mode}: matches native mean-shift status and output for $options`, async ({ options, position }) => {
        const files = new Map([["/in.ppm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", ...options, ...(position ? ["-format", "%k", "info:"] : ["-depth", "8", "rgba:-"])];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(position ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(position
            ? `magick: option deprecated, unable to execute '+mean-shift' at CLI arg ${position}\n` : "");
        expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
            ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
            .toBe(position ? "" : rgba);
    });
}
