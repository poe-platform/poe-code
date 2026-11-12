import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete scanline-order RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "matching translucent background", input: ["xc:#4080c080"], background: "#4080c080", interpolation: "mesh", angle: "30", expected: "4080c080".repeat(9) },
        { name: "different translucent background", input: ["xc:#4080c080"], background: "#20402040", interpolation: "mesh", angle: "30", expected: "20402040".repeat(4) + "4080c080" + "20402040".repeat(4) },
        { name: "mixed translucent samples", input: ["xc:#4080c080", "xc:#20402040", "+append"], background: "#10203020", interpolation: "mesh", angle: "30", expected: "10203020".repeat(5) + "3b76ae641e3b2238" + "10203020".repeat(5) },
        { name: "bilinear control", input: ["xc:#4080c080"], background: "#4080c080", interpolation: "bilinear", angle: "30", expected: "4080c080".repeat(9) },
        { name: "opaque control", input: ["xc:#4080c0ff"], background: "#4080c0ff", interpolation: "mesh", angle: "30", expected: "4080c0ff".repeat(9) },
        { name: "right-angle control", input: ["xc:#4080c080"], background: "#4080c080", interpolation: "mesh", angle: "90", expected: "4080c080" },
    ])(`${mode}: Point rotation preserves $name`, async ({ input, background, interpolation, angle, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...input, "-background", background, "-filter", "Point", "-interpolate", interpolation, "-rotate", angle, "-depth", "8", "rgba:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? {
            ...await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr,
        } : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
