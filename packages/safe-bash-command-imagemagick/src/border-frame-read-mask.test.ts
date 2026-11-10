import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: "-border", masked: true, clear: false, expected: "6x5 0" },
        { operation: "-frame", masked: true, clear: false, expected: "6x5 0" },
        { operation: "-border", masked: false, clear: false, expected: "6x5 0.705882" },
        { operation: "-frame", masked: false, clear: false, expected: "6x5 0.625882" },
        { operation: "-border", masked: true, clear: true, expected: "dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf00070e151c232a31383f464ddfdfdfdfdfdf545b626970777e858c939aa1dfdfdfdfdfdfa8afb6bdc4cbd2d9e0e7eef5dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf" },
        { operation: "-frame", masked: true, clear: true, expected: "bdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbd00070e151c232a31383f464dbdbdbdbdbdbd545b626970777e858c939aa1bdbdbdbdbdbda8afb6bdc4cbd2d9e0e7eef5bdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbd" },
    ])(`matches native $operation read masks (masked=$masked, clear=$clear, ${mode})`, async ({ operation, masked, clear, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(masked ? ["-read-mask", "/mask.pgm"] : []), operation, "1x1",
            ...(clear ? ["+read-mask", "-depth", "8", "rgb:/out"] : ["-format", "%wx%h %[fx:mean.r]", "info:/out"])];
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
        expect(Buffer.from(output).toString(clear ? "hex" : "utf8")).toBe(expected);
    });
}
