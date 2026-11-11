import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: xc:#345caa80 -modulate 80,60,120 -depth 8 rgba:-.
const hsl = [75, 60, 117, 128], hsb = [94, 79, 136, 128];
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "first image artifact", ops: ["-set", "artifact:modulate:colorspace", "HSB", "xc:#345caa80"], expected: [...hsb, ...hsl] },
        { name: "global option", ops: ["-set", "option:modulate:colorspace", "HSB", "xc:#345caa80"], expected: [...hsb, ...hsb] },
        { name: "global define", ops: ["-define", "modulate:colorspace=HSB", "xc:#345caa80"], expected: [...hsb, ...hsb] },
        { name: "default", ops: ["xc:#345caa80"], expected: [...hsl, ...hsl] },
        { name: "artifact overrides define", ops: ["-define", "modulate:colorspace=HSB", "-set", "artifact:modulate:colorspace", "HSL", "xc:#345caa80"], expected: [...hsl, ...hsb] },
        { name: "artifact overrides option", ops: ["-set", "option:modulate:colorspace", "HSB", "-set", "artifact:modulate:colorspace", "HSL", "xc:#345caa80"], expected: [...hsl, ...hsb] },
        { name: "option replaces define", ops: ["-define", "modulate:colorspace=HSL", "-set", "option:modulate:colorspace", "hSb"], expected: hsb },
        { name: "removed artifact falls back to option", ops: ["-define", "modulate:colorspace=HSB", "-set", "artifact:modulate:colorspace", "HSL", "+set", "artifact:modulate:colorspace"], expected: hsb },
        { name: "removed option restores default", ops: ["-define", "modulate:colorspace=HSB", "+set", "option:modulate:colorspace"], expected: hsl },
        { name: "ordinary property is not an artifact", ops: ["-set", "modulate:colorspace", "HSB"], expected: hsl },
    ])(`${mode} modulates with $name`, async ({ ops, expected }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:#345caa80", ...ops, "-modulate", "80,60,120", "-depth", "8", "rgba:/out.rgba"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")!;
        expect([...output]).toEqual(expected);
    });
}
