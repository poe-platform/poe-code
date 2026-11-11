import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { options: ["-interpolate", "nearest"], format: "%[hex:p{0.6,0.6}]", expected: "800000008000" },
        { options: ["-interpolate", "integer"], format: "%[pixel:p{0.6,0.6}]", expected: "srgb(255,0,0)" },
        { options: ["-interpolate", "integer"], format: "%[fx:p{0.6,0.6}.r]", expected: "1" },
        { options: ["-interpolate", "bilinear"], format: "%[hex:p{0.6,0.6}]", expected: "B33300004CCD" },
        { options: ["-interpolate", "integer", "+interpolate"], format: "%[hex:p{0.6,0.6}]", expected: "B33300004CCD" },
    ])(`${mode}: formats $format with $options`, async ({ options, format, expected }) => {
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "3x3", "gradient:red-blue", ...options, "-format", format, "info:"];
        let stdout = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
