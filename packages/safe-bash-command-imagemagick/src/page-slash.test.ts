import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 leaves the current page intact for slash geometry.
for (const mode of ["sync", "buffered", "retained", "public"] as const) {
    for (const option of [["-repage"], ["-set", "page"]]) {
        for (const geometry of ["3x2/2", "4x3"]) {
            it.each(["info", "png", "flatten"])(`${mode} ${option.join(" ")} ${geometry} preserves the page and %s output`, async (output) => {
                const files = new Map<string, Uint8Array>();
                const fs = new MemoryFileSystem();
                const args = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", ...option, geometry,
                    ...(output === "flatten" ? ["-background", "black", "-flatten"] : []),
                    "-format", "%wx%h|%g;", output === "info" ? "info:" : "PNG32:/out.png"];
                const argumentValues = createCommandArguments(args);
                let stdout = "", stderr = "";
                const result = mode === "public" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
                    .toEqual({ exitCode: 0, stderr: "" });
                if (output === "info") {
                    expect("stdout" in result ? result.stdout : stdout).toBe("3x2|4x3+1+1;");
                    return;
                }
                const bytes = mode === "public" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
                const image = decodeImage(bytes);
                const flattened = output === "flatten";
                expect([image.width, image.height]).toEqual(flattened ? [4, 3] : [3, 2]);
                expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 })
                    .toEqual({ width: 4, height: 3, x: flattened ? 0 : 1, y: flattened ? 0 : 1 });
                const expected = new Uint8Array(image.width * image.height * 4);
                for (let y = 0; y < image.height; y++) {
                    for (let x = 0; x < image.width; x++) {
                        const index = (y * image.width + x) * 4;
                        expected[index] = !flattened || x > 0 && y > 0 ? 255 : 0;
                        expected[index + 3] = 255;
                    }
                }
                expect(image.data).toEqual(expected);
            });
        }
    }
}
