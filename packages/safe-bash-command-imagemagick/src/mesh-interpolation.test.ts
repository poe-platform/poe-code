import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const grid = ["(", "xc:black", "xc:red", "+append", ")", "(", "xc:lime", "xc:blue", "+append", ")", "-append"];
const alpha = ["xc:#ff000080", "xc:#0000ff40", "+append"];
const coordinates = ["0.25,0.6", "0.6,0.25", "0.2,0.3", "0.8,0.7", "0.5,0.5", "-0.25,0.6", "0,0"];
const format = coordinates.map(point => `%[hex:p{${point}}]`).join("|");

// Native ImageMagick 7.1.2-35 Q16-HDRI. FX and resize have distinct alpha weighting.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "FX format and qualifiers", input: grid, options: ["-format", "%[hex:p{0.25,0.6}]|%[hex:p{0.5,0.5}]|%[fx:p{0.25,0.6}.r]", "info:"], expected: "000059994000|000000008000|0" },
        { name: "NW-SE triangles and edge pixels", input: grid, options: ["-format", format, "info:"], expected: "000059994000|599900004000|0000199A3333|199A0000B333|000000008000|000099990000|000000000000" },
        { name: "NE-SW triangles", input: ["(", "xc:red", "xc:black", "+append", ")", "(", "xc:blue", "xc:lime", "+append", ")", "-append"], options: ["-format", format, "info:"], expected: "266600009999|266600004000|800000004CCD|000080003333|000000008000|666600009999|FFFF00000000" },
        { name: "translucent FX triangles", input: ["(", "xc:#ff000080", "xc:#0000ff40", "+append", ")", "(", "xc:#00ff0020", "xc:#ffffff00", "+append", ")", "-append"], options: ["-format", format, "info:"], expected: "5A5A5A5A4B4B369D|4AED1F3895DA41DB|BDA01C7225ED56BD|00004000BFFF19B3|00005555AAAA3030|BA2E45D1000046AD|FFFF000000008080" },
        { name: "FX pixels", input: grid, options: ["-fx", "p{0.25,0.6}", "-depth", "8", "rgba:/out.rgba"], expected: "005940ff".repeat(4) },
        { name: "FX translucent pixels", input: alpha, options: ["-fx", "p{0.5,0}", "-depth", "8", "rgba:/out.rgba"], expected: "aa005560".repeat(2) },
        { name: "translucent resize", input: alpha, options: ["-interpolative-resize", "3x1!", "-depth", "8", "rgba:/out.rgba"], expected: "ff000080ff00ff600000ff40" },
        { name: "bilinear FX control", input: grid, options: ["-interpolate", "bilinear", "-fx", "p{0.25,0.6}", "-depth", "8", "rgba:/out.rgba"], expected: "1a7326ff".repeat(4) },
        { name: "bilinear resize control", input: alpha, options: ["-interpolate", "bilinear", "-interpolative-resize", "3x1!", "-depth", "8", "rgba:/out.rgba"], expected: "ff000080aa0055600000ff40" },
    ])(`${mode}: mesh $name`, async ({ input, options, expected }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = [...input, "-interpolate", "mesh", ...options];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        if (options.at(-1) === "info:") expect("stdout" in result ? result.stdout : stdout).toBe(expected);
        else expect(Buffer.from(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgba") : files.get("/out.rgba")!).toString("hex")).toBe(expected);
    });
}
