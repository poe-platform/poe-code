import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: "-border", geometry: "0x0", masked: true, edit: true, expected: "ff070eea1c23d53138c0464dab5b6296707781858c6c9aa157afb642c4cb2dd9e018eef5" },
        { operation: "-frame", geometry: "0x0", masked: true, edit: true, expected: "ff070eea1c23d53138c0464dab5b6296707781858c6c9aa157afb642c4cb2dd9e018eef5" },
        { operation: "-border", masked: true, edit: true, expected: "20dfdf20dfdf20dfdf20dfdf20dfdf20dfdf20dfdfff070eea1c23d53138c0464d20dfdf20dfdfab5b6296707781858c6c9aa120dfdf20dfdf57afb642c4cb2dd9e018eef520dfdf20dfdf20dfdf20dfdf20dfdf20dfdf20dfdf" },
        { operation: "-frame", masked: true, edit: true, expected: "42bdbd42bdbd42bdbd42bdbd42bdbd42bdbd42bdbdff070eea1c23d53138c0464d42bdbd42bdbdab5b6296707781858c6c9aa142bdbd42bdbd57afb642c4cb2dd9e018eef542bdbd42bdbd42bdbd42bdbd42bdbd42bdbd42bdbd" },
        { operation: "-border", masked: false, edit: true, expected: "20dfdf20dfdf20dfdf20dfdf20dfdf20dfdf20dfdfff070eea1c23d53138c0464d20dfdf20dfdfab5b6296707781858c6c9aa120dfdf20dfdf57afb642c4cb2dd9e018eef520dfdf20dfdf20dfdf20dfdf20dfdf20dfdf20dfdf" },
        { operation: "-frame", masked: false, edit: true, expected: "42bdbd42bdbd42bdbd42bdbd42bdbd42bdbd42bdbdff070eea1c23d53138c0464d42bdbd42bdbdab5b6296707781858c6c9aa142bdbd42bdbd57afb642c4cb2dd9e018eef542bdbd42bdbd42bdbd42bdbd42bdbd42bdbd42bdbd" },
        { operation: "-border", masked: true, edit: false, expected: "dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf00070e151c232a31383f464ddfdfdfdfdfdf545b626970777e858c939aa1dfdfdfdfdfdfa8afb6bdc4cbd2d9e0e7eef5dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf" },
        { operation: "-frame", masked: true, edit: false, expected: "bdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbd00070e151c232a31383f464dbdbdbdbdbdbd545b626970777e858c939aa1bdbdbdbdbdbda8afb6bdc4cbd2d9e0e7eef5bdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbdbd" },
    ])(`matches native $operation write masks ($geometry, masked=$masked, edit=$edit, ${mode})`, async ({ operation, geometry = "1x1", masked, edit, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(masked ? ["-write-mask", "/mask.pgm"] : []), operation, geometry,
            ...(edit ? ["-channel", "R", "-negate", "+channel"] : []), "+write-mask", "-depth", "8", "rgb:/out"];
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
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
