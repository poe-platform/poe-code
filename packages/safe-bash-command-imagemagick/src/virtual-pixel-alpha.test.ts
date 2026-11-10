import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "transparent channels", operations: ["-virtual-pixel", "transparent", "-format", "%wx%h %g %[channels]", "info:out"], expected: "1x1 1x1+0+0 srgba 4.0", text: true },
        { name: "transparent negate", operations: ["-virtual-pixel", "transparent", "-negate"], expected: "00ffff00" },
        { name: "transparent background negate", operations: ["-background", "none", "-virtual-pixel", "background", "-negate"], expected: "00ffff00" },
        { name: "transparent splice", operations: ["-background", "blue", "-virtual-pixel", "transparent", "-splice", "1x0+2+0"], expected: "ff0000ff00000000" },
        { name: "black control", operations: ["-background", "none", "-virtual-pixel", "black", "-negate"], expected: "00ffffff" },
        { name: "opaque background control", operations: ["-background", "blue", "-virtual-pixel", "background", "-negate"], expected: "00ffffff" },
        { name: "edge splice control", operations: ["-background", "blue", "-virtual-pixel", "edge", "-splice", "1x0+2+0"], expected: "ff0000ffff0000ff" },
        { name: "background captured before later change", operations: ["-background", "none", "-virtual-pixel", "background", "-background", "blue", "-negate"], expected: "00ffff00" },
        { name: "reset preserves alpha", operations: ["-virtual-pixel", "transparent", "+virtual-pixel", "-negate"], expected: "00ffff00" },
    ])(`sets virtual pixel alpha: $name, ${mode}`, async ({ operations, expected, text }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("out")!);
        const args = ["xc:red", ...operations, ...(text ? [] : ["-depth", "8", "rgba:out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(text ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
