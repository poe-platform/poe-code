import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operations: ["-transpose"], masked: true, expected: "3x4 0.0823529" },
        { operations: ["-transverse"], masked: true, expected: "3x4 0.0823529" },
        { operations: ["-transpose", "-transpose"], masked: true, expected: "4x3 0.0823529" },
        { operations: ["-transverse", "-transverse"], masked: true, expected: "4x3 0.0823529" },
        { operations: ["-transpose"], masked: false, expected: "3x4 0.452941" },
        { operations: ["-transverse"], masked: false, expected: "3x4 0.452941" },
        { operations: ["-roll", "+2-1"], masked: true, expected: "4x3 0.0823529" },
    ])(`keeps read-mask samples aligned through $operations (masked=$masked, ${mode})`, async ({ operations, masked, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(masked ? ["-read-mask", "/mask.pgm"] : []), ...operations, "-format", "%wx%h %[fx:mean.r]", "info:/out"];
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
