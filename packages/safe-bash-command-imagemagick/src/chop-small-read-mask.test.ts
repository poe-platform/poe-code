import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { mask: "xc:white", chop: "", removeMask: false, expected: "5x4 0.0392157" },
        { mask: "xc:white", chop: "2x1+0+0", removeMask: false, expected: "3x3 0" },
        { mask: "xc:white", chop: "2x1+1+1", removeMask: false, expected: "3x3 0.0392157" },
        { mask: "xc:white", chop: "1x0+0+0", removeMask: false, expected: "4x4 0" },
        { mask: "xc:white", chop: "0x1+0+0", removeMask: false, expected: "5x3 0" },
        { mask: "xc:white", chop: "2x1+0+0", removeMask: true, expected: "3x3 0.192157" },
        { mask: "", chop: "2x1+0+0", removeMask: false, expected: "3x3 0.192157" },
        { mask: "/mask.pgm", chop: "2x1+0+0", removeMask: false, expected: "3x3 0" },
    ])(`chops a one-pixel read selection: $mask $chop (removeMask=$removeMask, ${mode})`, async ({ mask, chop, removeMask, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => i + 10))]);
        const fullMask = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from([255, ...Array<number>(19).fill(0)])]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", fullMask]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(mask ? ["-read-mask", mask] : []), ...(chop ? ["-chop", chop] : []), ...(removeMask ? ["+read-mask"] : []), "-format", "%wx%h %[fx:mean.r]", "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
