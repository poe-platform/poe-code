import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-sample", "-scale", "-resize", "-thumbnail"]) {
        it.each([
            { geometry: "%[dims]", property: "option:dims", value: "2x1!", literal: "2x1!" },
            { geometry: "%[option:dims]", property: "option:dims", value: "2x1!", literal: "2x1!" },
            { geometry: "%[dims]", property: "dims", value: "2x1!", literal: "2x1!" },
            { geometry: "%[fx:w/2]x1!", property: "option:dims", value: "2x1!", literal: "2x1!" },
            { geometry: "2x1!", property: "option:dims", value: "2x1!", literal: "2x1!" },
            { geometry: "%[dims]", property: "option:dims", value: "50%", literal: "50%" },
            { geometry: "50%", property: "option:dims", value: "2x1!", literal: "50%" },
            { geometry: "%[dims]", property: "option:dims", value: "bad", literal: "bad" },
        ])(`${mode} ${operation} expands $geometry ($property=$value)`, async ({ geometry, property, value, literal }) => {
            const input = Uint8Array.from([
                ...new TextEncoder().encode("P6\n4 3\n255\n"),
                ...Array.from({ length: 36 }, (_, i) => i * 7),
            ]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.ppm", input], ["/out", keep], ["/out.png", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argumentValues = createCommandArguments([
                "/in.ppm", "-set", property, value, operation, geometry,
                "-set", "option:dims", "bad", "-write", "PNG64:/out.png", "-format", "%wx%h %g", "info:/out",
            ]);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
                : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            if (value === "bad") {
                expect(result.exitCode).toBe(1);
                expect(stderr).toContain(`invalid argument for option '${operation}': bad`);
                expect(output).toEqual(keep);
                expect(pixels).toEqual(keep);
                return;
            }
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const height = literal === "50%" ? 2 : 1;
            // Native ImageMagick 7.1.2-35 Q16-HDRI canvas behavior.
            expect(new TextDecoder().decode(output)).toBe(`2x${height} ${operation === "-thumbnail" ? "0x0" : `2x${height}`}+0+0`);
            const controls = new Map([["/in.ppm", input]]);
            expect(runMagickCliSync(["/in.ppm", operation, literal, "PNG64:/control.png"], controls).exitCode).toBe(0);
            const actual = decodeImage(pixels), expected = decodeImage(controls.get("/control.png")!);
            expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
            expect(actual.data16).toEqual(expected.data16);
        });
    }
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it.each(["-sample", "-scale", "-resize", "-thumbnail"])(`${mode} %s evaluates FX against each current image`, async operation => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "4x3", "xc:red", "-size", "8x5", "xc:blue", operation, "%[fx:w/2]x1!", "-format", "%wx%h;", "info:"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "2x1;4x1;" });
    });
}
