import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference class and raw RGBA pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { type: "PaletteAlpha", output: "info", expected: "DirectClass sRGB Alpha" },
    { type: "PaletteAlpha", output: "pixels", expected: "9b6e3a60b2ffffa0cface0ea" },
    { type: "PaletteAlpha", output: "cycle", expected: "b2ffffffcface0ff9b6e3aff" },
    { type: "TrueColorAlpha", output: "cycle", expected: "b2ffffffcface0ff9b6e3aff" },
    { type: "PaletteAlpha", output: "cycle16", expected: "b2b5ffffffffffffcfd3ad0de07dffff9bca6e503a16ffff" },
    { type: "PaletteAlpha", output: "cycle-info", expected: "0.698077,1.06347,1.06037" },
    { type: "PaletteAlpha", output: "cycle-repeat-info", expected: "0.698077,1.06347,1.06037" }
])(`${mode}: CLAHE $type $output`, async ({ type, output, expected }) => {
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("/out")!);
    const cycle = output.startsWith("cycle") ? ["-cycle", "1"] : [];
    const info = output.endsWith("info");
    const argv = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append", "-type", type,
        "-clahe", "2x2+16+2", ...(output === "info" ? ["-format", "%r", "info:/out"]
            : [...cycle, ...(output === "cycle-repeat-info" ? [...cycle, ...cycle, ...cycle] : []),
                ...(info ? ["-format", "%[fx:r],%[fx:g],%[fx:b]", "info:/out"]
                    : ["-depth", output === "cycle16" ? "16" : "8", "-endian", "MSB", "rgba:/out"])])];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
    expect(Buffer.from(actual).toString(info ? "utf8" : "hex")).toBe(expected);
});
