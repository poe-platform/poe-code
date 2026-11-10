import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { options: ["-read-mask", "/mask.pgm", "-trim"], expected: "2x2 0.385621" },
        { options: ["-read-mask", "/mask.pgm"], expected: "6x5 0.385621" },
        { options: ["-trim"], expected: "2x2 0.338235" },
        { options: ["-read-mask", "/mask.pgm", "-trim", "+read-mask"], expected: "png" },
    ])(`keeps the read mask aligned with the trim rectangle: $options (${mode})`, async ({ options, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference values.
        const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
        pixels[1] = [102, 120, 140];
        pixels[14] = [26, 38, 54];
        pixels[15] = [50, 100, 130];
        pixels[20] = [69, 21, 90];
        pixels[21] = [200, 230, 17];
        const input = Buffer.concat([Buffer.from("P6\n6 5\n255\n"), Buffer.from(pixels.flat())]);
        const mask = Buffer.concat([Buffer.from("P5\n6 5\n255\n"), Buffer.from(Array.from({ length: 30 }, (_, i) => [14, 20, 21].includes(i) ? 255 : 0))]);
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", "-fuzz", "3%", ...options, ...(expected === "png" ? ["PNG32:/out"] : ["-format", "%wx%h %[fx:mean.r]", "info:/out"])];
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
        if (expected === "png") {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([2, 2]);
            expect(Buffer.from(image.data).toString("hex")).toBe("1a2636ff326482ff45155affc8e611ff");
        } else expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
