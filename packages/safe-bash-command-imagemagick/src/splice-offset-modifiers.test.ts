import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: modifiers preserve both dimensions and pixel offsets.
const cases = [
    ...["!", "^", "<", ">", "@", "#"].flatMap(modifier => [
        `1x1+1${modifier}+1`, `1x1${modifier}+1+1`,
    ]).map(geometry => ({ geometry, dimensions: "4x2", hex: "123456ff00008badcffedcbaff0000ff0000ff0000ff0000" })),
    ...["1x0+50%+0", "1x0%+50+0"].map(geometry => ({
        geometry, dimensions: "3x1", hex: "1234568badcffedcba",
    })),
    ...["50x100+1%+1", "50x100%+1+1"].map(geometry => ({
        geometry, dimensions: "5x2", hex: "123456ff0000ff00008badcffedcbaff0000ff0000ff0000ff0000ff0000",
    })),
    ...["4x2+1>+1", "4x2>+1+1"].map(geometry => ({
        geometry, dimensions: "6x2", hex: "ff0000ff0000ff0000ff0000ff0000ff0000ff0000ff0000ff00001234568badcffedcba",
    })),
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["rgb", "info"]) {
        it.each(cases)(`preserves splice modifiers between offsets (${mode}, ${format}): $geometry`, async ({ geometry, dimensions, hex }) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#123456", "xc:#8badcf", "xc:#fedcba", "+append", "-background", "red",
                "-splice", geometry, "-depth", "8", "-format", "%wx%h", `${format}:-`];
            let stdout = new Uint8Array(), stderr = "";
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout = Uint8Array.from([...stdout, ...chunk]); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            if (format === "info") {
                expect("stdout" in result ? result.stdout : new TextDecoder().decode(stdout)).toBe(dimensions);
            } else {
                expect(Buffer.from("stdoutBytes" in result ? result.stdoutBytes! : stdout).toString("hex")).toBe(hex);
            }
        });
    }
}
