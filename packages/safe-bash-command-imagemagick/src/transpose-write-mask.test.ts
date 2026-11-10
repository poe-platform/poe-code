import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operations: ["-transpose"], masked: true, negate: true, expected: "ff070eab5b6257afb6151c2396707742c4cbd5313881858c2dd9e0c0464d6c9aa118eef5" },
        { operations: ["-transverse"], masked: true, negate: true, expected: "18eef56c9aa1c0464d2dd9e081858cd5313842c4cb967077151c2357afb6ab5b62ff070e" },
        { operations: ["-transpose"], masked: true, negate: false, expected: "00070e545b62a8afb6151c23697077bdc4cb2a31387e858cd2d9e03f464d939aa1e7eef5" },
        { operations: ["-transverse"], masked: true, negate: false, expected: "e7eef5939aa13f464dd2d9e07e858c2a3138bdc4cb697077151c23a8afb6545b6200070e" },
        { operations: ["-transpose"], masked: false, negate: true, expected: "ff070eab5b6257afb6ea1c2396707742c4cbd5313881858c2dd9e0c0464d6c9aa118eef5" },
        { operations: ["-transverse"], masked: false, negate: true, expected: "18eef56c9aa1c0464d2dd9e081858cd5313842c4cb967077ea1c2357afb6ab5b62ff070e" },
        { operations: ["-roll", "+2-1"], masked: true, negate: true, expected: "81858cea1c23ab5b629670772dd9e018eef557afb642c4cbd53138c0464dff070e151c23" },
    ])(`keeps write-mask pixels aligned through $operations (masked=$masked, negate=$negate, ${mode})`, async ({ operations, masked, negate, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 reference bytes.
        const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
        const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(masked ? ["-write-mask", "/mask.pgm"] : []), ...operations,
            ...(negate ? ["-channel", "R", "-negate", "+channel"] : []), "+write-mask", "-depth", "8", "rgb:/out"];
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
