import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from([1, 2, 3, 4, 5, 6])]);
// Verified with native ImageMagick 7.1.2: replacement images detach the input blob.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: [], size: "17", dimensions: "2x1" },
        { operation: ["-negate"], size: "17", dimensions: "2x1" },
        { operation: ["-flip"], size: "0", dimensions: "2x1" },
        { operation: ["-flop"], size: "0", dimensions: "2x1" },
        { operation: ["-resize", "3x2!"], size: "0", dimensions: "2x1" },
        { operation: ["-resize", "6x4!"], size: "0", dimensions: "2x1" },
        { operation: ["-resize", "6x4>"], size: "0", dimensions: "2x1" },
        { operation: ["-sample", "3x2!"], size: "0", dimensions: "2x1" },
        { operation: ["-scale", "3x2!"], size: "0", dimensions: "2x1" },
        { operation: ["-thumbnail", "3x2!"], size: "0", dimensions: "2x1" },
        { operation: ["-crop", "3x2+0+0"], size: "0", dimensions: "2x1" },
        { operation: ["-crop", "2x2+0+0"], size: "0", dimensions: "2x2" },
        { operation: ["-thumbnail", "2x2"], size: "0", dimensions: "2x1" }
    ])(`preserves thumbnail source dimensions after $operation (${mode})`, async ({ operation, size, dimensions }) => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/frame 1.pgm", input);
        const files = new Map([["frame 1.pgm", input]]);
        const args = ["frame 1.pgm", ...operation, "-thumbnail", "2x2", "-write", "out.png",
            "-format", "%[Thumb::Size]|%[Thumb::Image::Width]x%[Thumb::Image::Height]|%wx%h", "info:"];
        let stdout = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } } });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            stdout = result.stdout;
        }
        expect(stdout).toBe(`${size}|3x2|${dimensions}`);
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect(output.properties).toMatchObject({ "Thumb::Size": size, "Thumb::Image::Width": "3", "Thumb::Image::Height": "2" });
        if (operation[0] === "-flip") expect([...output.data.filter((_, index) => index % 4 === 0)]).toEqual([3, 4]);
    });
}
