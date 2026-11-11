import { describe, expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = Uint8Array.from([10, 20, 30, 40, 50, 60].flatMap(value => [value, value, value, 255]));
const input = encodeImage({ width: 3, height: 2, data: pixels, format: "png", space: "srgb",
    channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;

describe.each(["command", "retained", "buffered", "sync"] as const)("option assignment expansion (%s)", mode => {
    async function execute(args: string[]) {
        const fs = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await fs.writeFile("/input.png", input);
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained"
            ? await fs.readFile("/output").catch(() => undefined) : files.get("/output");
        return { stdout, output };
    }

    it.each(["%h", "%[fx:h]", "2"])("captures %s before resizing", async value => {
        const result = await execute(["-size", "3x2", "xc:red", "-set", "option:dx", value,
            "-resize", "1x1!", "-format", "%[dx]|%[option:dx]|%h", "info:"]);
        expect(result.stdout).toBe("2|2|1");
    });

    it("expands immediately without a later transform", async () => {
        expect((await execute(["/input.png", "-set", "option:dx", "%h", "-format", "%[dx]", "info:"])).stdout).toBe("2");
    });

    it("captures prior option values before they are reassigned", async () => {
        const result = await execute(["/input.png", "-set", "option:dx", "%h",
            "-set", "option:saved", "%[option:dx]", "-set", "option:dx", "%w",
            "-format", "%[saved]|%[dx]", "info:"]);
        expect(result.stdout).toBe("2|3");
    });

    it("uses the first current image and the current list for FX", async () => {
        const result = await execute(["/input.png", "-size", "5x4", "xc:blue",
            "-set", "option:dx", "%h", "-set", "option:other", "%[fx:u[1].h]",
            "-format", "%[dx]|%[other];", "info:"]);
        expect(result.stdout).toBe("2|4;2|4;");
    });

    it("preserves literal options assigned before an input", async () => {
        expect((await execute(["-set", "option:dx", "2", "/input.png", "-format", "%[dx]", "info:"])).stdout).toBe("2");
    });

    it.each(["%h", "%[fx:w-1]"])("rolls with the assigned %s value", async value => {
        const result = await execute(["/input.png", "-set", "option:dx", value,
            "-roll", "+%[dx]+0", "-depth", "8", "rgba:/output"]);
        expect(result.output).toEqual(Uint8Array.from([20, 30, 10, 50, 60, 40].flatMap(pixel => [pixel, pixel, pixel, 255])));
    });

    it.each(["%h", "%[fx:w-1]"])("waves with the assigned %s value", async value => {
        const result = await execute(["/input.png", "-set", "option:amplitude", value,
            "-wave", "%[amplitude]x4", "-depth", "8", "rgba:/output"]);
        const control = await execute(["/input.png", "-wave", "2x4", "-depth", "8", "rgba:/output"]);
        expect(result.output).toEqual(control.output);
    });
});
