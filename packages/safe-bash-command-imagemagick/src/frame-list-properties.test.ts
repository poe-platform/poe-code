import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const colors = { R: [255, 0, 0, 255], G: [0, 255, 0, 255], B: [0, 0, 255, 255], W: [255, 255, 255, 255], C: [0, 255, 255, 255], Y: [255, 255, 0, 255] };
for (const mode of ["public", "sync"] as const) {
    it.each([
        { options: ["-delete", "%[fx:n-1]"], order: "RGB" },
        { options: ["-clone", "%[fx:0],%[fx:2]"], order: "RGBWRB" },
        { options: ["(", "xc:cyan", "xc:yellow", "-clone", "%[fx:n-1]", ")"], order: "RGBWCYG" },
        { options: ["(", "-clone", "%[fx:n-1]", ")"], order: "RGBWR" },
        { options: ["-set", "label", "3", "(", "xc:cyan", "-set", "label", "1", "-clone", "%[label]", ")"], order: "RGBWCG" },
        { options: ["-clone", "%[fx:n-1]"], order: "RGBWW" },
        { options: ["(", "-clone", "3", ")"], order: "RGBWW" },
        { options: ["-duplicate", "%[fx:1]"], order: "RGBWW" },
        { options: ["-insert", "%w"], order: "RWGB" },
        { options: ["-set", "option:k", "2", "-swap", "%[option:k]"], order: "RGWB" },
        { options: ["-duplicate", "%[fx:1],%[fx:0],%[fx:2]"], order: "RGBWRB" },
        { options: ["-delete", "%[fx:n-1]", "-delete", "%[fx:n-1]"], order: "RG" },
        { options: ["-set", "option:k", "2", "-swap", "%[option:k]", "-set", "option:k", "0"], order: "RGWB" },
        { options: ["-delete", "3"], order: "RGB" },
        { options: ["-swap", "2"], order: "RGWB" },
    ])(`${mode} expands frame-list operands: $options`, async ({ options, order }) => {
        const argumentValues = createCommandArguments([
            "-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", ...options, "+append", "PNG24:out.png",
        ]);
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argumentValues.args, files)
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const image = decodeImage(mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
        expect([image.width, image.height]).toEqual([order.length, 1]);
        expect([...image.data]).toEqual([...order].flatMap(color => colors[color as keyof typeof colors]));
    });
}
