import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const region = ["-region", "2x1+1+0"];
const crop = ["-crop", "2x2+1+0"];
const negate = ["-channel", "R", "-negate", "+channel"];

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { name: "moves the region with cropped pixels", options: [...region, ...crop, ...negate, "+region"], expected: "ea1c23d531386970777e858c" },
        { name: "preserves the uncropped region", options: [...region, ...negate, "+region"], expected: "00070eea1c23d531383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0e7eef5" },
        { name: "clears the cropped region", options: [...region, ...crop, "+region"], expected: "151c232a31386970777e858c" },
        { name: "negates the entire crop without a region", options: [...crop, ...negate], expected: "ea1c23d5313896707781858c" },
    ])(`$name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["/in.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.ppm", ...options, "-depth", "8", "rgb:/out"];
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
