import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: combining palette planes produces DirectClass.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const type of ["Palette", "PaletteAlpha", "TrueColor"])
for (const output of ["info", "pixels", "cycle"] as const)
it(`${mode}: combine ${type} ${output}`, async () => {
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("/out")!);
    const inputs = output === "info" ? ["xc:#204080", "xc:#905030", "xc:#7010b0"] : [
        "(", "xc:#204080", "xc:#905030", "+append", ")",
        "(", "xc:#7010b0", "xc:#807040", "+append", ")",
        "(", "xc:#40a0b0", "xc:#2070c0", "+append", ")"
    ];
    const argv = [...inputs, "-type", type, "-combine", ...(output === "info"
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
    expect(Buffer.from(actual).toString(output === "info" ? "utf8" : "hex")).toBe(output === "info"
        ? type === "PaletteAlpha" ? "DirectClass sRGB Alpha|srgba 4.0" : "DirectClass sRGB |srgb  3.0"
        : output === "cycle" ? "5b7065ff3e308dff" : "3e308dff5b7065ff");
});
