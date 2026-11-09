import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// 8x2 PNG from the reported reproduction.
const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAACCAYAAABllJ3tAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MjY6NTIrMDA6MDBVqnujAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjI2OjUyKzAwOjAwJPfDHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoyNjo1MiswMDowMHPi4sAAAAA+SURBVAjXPcohDsBACARA1uHAkpMgMA1qH8gj+58TTSonGYjI4+6cGQIgAGYmzzmfd/etKkbEH1SV3U0z4wUJ2whoSKOnWgAAAABJRU5ErkJggg==", "base64"));

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const operator of ["-level", "+level"] as const) {
        it.each([
            { label: "before the first image", prefix: [], suffix: ["r.png"], valid: false },
            { label: "after deleting all images", prefix: ["r.png", "+delete"], suffix: ["r.png"], valid: false },
            { label: "inside an empty image group", prefix: ["r.png", "("], suffix: ["r.png", ")"], valid: false },
            { label: "after the input image", prefix: ["r.png"], suffix: [], valid: true }
        ])(`${mode}: ${operator} $label`, async ({ prefix, suffix, valid }) => {
            for (const geometry of ["25%,75%", "%[fx:25],75%"]) {
                const original = new TextEncoder().encode("KEEP");
                const files = new Map([["r.png", input], ["o.png", original]]);
                const fs = new MemoryFileSystem();
                for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
                const args = [...prefix, operator, geometry, ...suffix, "PNG32:o.png"];
                let stdout = "", stderr = "";
                const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                const output = mode === "buffered" || mode === "sync" ? files.get("o.png")! : await fs.readFile("/o.png");
                expect.soft(result.exitCode).toBe(valid ? 0 : 1);
                expect.soft(result.stdout).toBe("");
                if (valid) {
                    expect(result.stderr).toBe("");
                    const image = decodeImage(output);
                    expect([image.width, image.height]).toEqual([8, 2]);
                    const expected = Array.from(decodeImage(input).data, value => operator === "-level"
                        ? Math.round(Math.max(0, Math.min(255, (value - 255 / 4) * 2)))
                        : Math.round(255 / 4 + value / 2));
                    expect(Array.from(image.data)).toEqual(expected);
                } else {
                    expect.soft(result.stderr).toContain(`no images found for operation '${operator}'`);
                    expect.soft(output).toEqual(original);
                }
            }
        });
    }
}
