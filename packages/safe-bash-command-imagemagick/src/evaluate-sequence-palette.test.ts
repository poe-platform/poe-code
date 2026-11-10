import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference metadata and raw RGBA pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { type: "Palette", operator: ["-evaluate-sequence", "Mean"], output: "info", expected: "DirectClass sRGB |srgb  3.0" },
    { type: "PaletteAlpha", operator: ["-evaluate-sequence", "Median"], output: "info", expected: "DirectClass sRGB Alpha|srgba 4.0" },
    { type: "TrueColor", operator: ["-evaluate-sequence", "Mean"], output: "info", expected: "DirectClass sRGB |srgb  3.0" },
    { type: "Palette", operator: ["-evaluate-sequence", "Mean"], output: "pixels", expected: "6f5256ff6a8b9cff" },
    { type: "Palette", operator: ["-evaluate-sequence", "Mean"], output: "cycle", expected: "6a8b9cff6f5256ff" },
    { type: "TrueColor", operator: ["-evaluate-sequence", "Mean"], output: "cycle", expected: "6a8b9cff6f5256ff" },
    { type: "Palette", operator: ["-average"], output: "cycle", expected: "6a8b9cff6f5256ff" }
])(`${mode}: $operator $type $output`, async ({ type, operator, output, expected }) => {
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("/out")!);
    const inputs = output === "info" ? ["xc:#b5267382", "xc:#297d3846"] : [
        "(", "xc:#b5267382", "xc:#297d3846", "+append", ")",
        "(", "xc:#297d3846", "xc:#aa99ff", "+append", ")"
    ];
    const argv = [...inputs, "-type", type, ...operator, ...(output === "info"
        ? ["-format", "%r|%[channels]", "info:/out"]
        : [...(output === "cycle" ? ["-cycle", "1"] : []), "-depth", "8", "rgba:/out"])];
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
    expect(Buffer.from(actual).toString(output === "info" ? "utf8" : "hex")).toBe(expected);
});
