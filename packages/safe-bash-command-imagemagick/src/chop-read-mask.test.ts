import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { chop: "1x1+1+1", removeMask: false, expected: "3 2 0.864706" },
        { chop: "0x1+0+1", removeMask: false, expected: "4 2 0.603922" },
        { chop: "1x0+1+0", removeMask: false, expected: "3 3 0.638235" },
        { chop: "1x1+1+1", removeMask: true, expected: "3x2 0.466667" },
        { chop: "", removeMask: false, expected: "4 3 0.527059" },
    ])(`keeps read-mask samples aligned after chop $chop (removeMask=$removeMask, ${mode})`, async ({ chop, removeMask, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 255])]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", "-read-mask", "/mask.pgm", ...(chop ? ["-chop", chop] : []), ...(removeMask ? ["+read-mask"] : []), "-format", removeMask ? "%wx%h %[fx:mean.r]" : "%w %h %[fx:mean.r]", "info:/out"];
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
