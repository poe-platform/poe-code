import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference metadata and raw RGBA pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { type: "Palette", operator: "Add", output: "info", expected: "DirectClass sRGB |srgb  3.0;DirectClass sRGB |srgb  3.0;" },
    { type: "PaletteAlpha", operator: "Multiply", output: "info", expected: "DirectClass sRGB Alpha|srgba 4.0;DirectClass sRGB Alpha|srgba 4.0;" },
    { type: "TrueColor", operator: "Add", output: "info", expected: "DirectClass sRGB |srgb  3.0;DirectClass sRGB |srgb  3.0;" },
    { type: "Palette", operator: "Add", output: "pixels", expected: "40e0ffff60ffc0ffc08040ff8020ffff" },
    { type: "Palette", operator: "Add", output: "cycle", expected: "60ffc0ff40e0ffff8020ffffc08040ff" },
    { type: "TrueColor", operator: "Add", output: "cycle", expected: "60ffc0ff40e0ffff8020ffffc08040ff" }
])(`${mode}: complex $operator $type $output`, async ({ type, operator, output, expected }) => {
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("/out")!);
    const inputs = output === "info" ? ["xc:#2070a031", "xc:#30906082", "xc:#60402060", "xc:#40108044"] : [
        "(", "xc:#2070a031", "xc:#30906082", "+append", ")",
        "(", "xc:#60402060", "xc:#40108044", "+append", ")"
    ];
    const argv = [...inputs, "-type", type, "-complex", operator, ...(output === "info"
        ? ["-format", "%r|%[channels];", "info:/out"]
        : [...(output === "cycle" ? ["-cycle", "1"] : []), "+append", "-depth", "8", "rgba:/out"])];
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
