import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["6x5!", false, "10.3333/3/20"],
        ["6x5!", true, "8.83333/1/20"],
        ["5x4!", false, "11.5/3/20"],
        ["5x4!", true, "10.5/1/20"],
        ["3x3!", false, "3"],
    ] as const)(`retains the carved read mask at %s (remove=%s, ${mode})`, async (geometry, remove, expected) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const input = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i + 1))]);
        const mask = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i % 5 < 2 ? 0 : 255))]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const format = geometry === "3x3!" ? "%[fx:255*minima]" : "%[fx:255*mean]/%[fx:255*minima]/%[fx:255*maxima]";
        const args = ["/in.ppm", "-read-mask", "/mask.pgm", "-liquid-rescale", geometry, ...(remove ? ["+read-mask"] : []), "-format", format, "info:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
