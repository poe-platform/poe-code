import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains stored alpha on an opaque extent canvas.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const evaluate of [false, true]) it.each([
        { alpha: "Discrete", background: "white", output: "channels", expected: "srgba 4.0" },
        { alpha: "Deactivate", background: "white", output: "channels", expected: "srgba 4.0" },
        { alpha: "Discrete", background: "white", output: "pixels", expected: "ffff" },
        { alpha: "Discrete", background: "none", output: "pixels", expected: "6000" },
        { alpha: "On", background: "white", output: "pixels", expected: "ffff" },
    ])(`${mode}: extent preserves $alpha alpha on $background ($output, evaluate=${evaluate})`, async ({ alpha, background, output, expected }) => {
        const argv = ["xc:#80402060", "-alpha", alpha, ...(evaluate ? ["-evaluate", "Add", "0"] : []), "-background", background, "-bordercolor", background,
            "-extent", "2x1", ...(output === "channels" ? ["-format", "%[channels]", "info:out"]
                : ["-channel", "A", "-separate", "+channel", "-depth", "8", "gray:out"])];
        const keep = new TextEncoder().encode("KEEP"), filesystem = new MemoryFileSystem();
        const files = new Map([["out", keep]]);
        await filesystem.writeFile("/out", keep);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(output === "channels" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
