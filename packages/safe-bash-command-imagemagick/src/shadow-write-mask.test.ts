import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI write-mask shadow pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const clear of [false, true]) it.each([
        ["black", ["-write-mask", "xc:black"], true, "d0402000"],
        ["white", ["-write-mask", "xc:white"], true, "d0402000"],
        ["absent", [], true, "d0402066"],
        ["black without shadow", ["-write-mask", "xc:black"], false, "50609080"],
        ["cleared before shadow", ["-write-mask", "xc:white", "+write-mask"], true, "d0402066"],
    ] as const)(`matches %s write-mask shadow pixels (${mode}, clear afterward: ${clear})`, async (_name, mask, shadow, pixel) => {
        const sentinel = new TextEncoder().encode("KEEP");
        const files = new Map([["/out", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", sentinel);
        const args = ["xc:#50609080", ...mask,
            "-background", "#d04020", ...(shadow ? ["-shadow", "80x0+0+0"] : []), ...(clear ? ["+write-mask"] : []),
            "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(pixel);
    });
}
