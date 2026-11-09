import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAzAJkARJyxf98AAAAHdElNRQfqCwcKHxfSEpVjAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6MjMrMDA6MDCPuxfTAAAAOUlEQVQI12O8ayDQwIAGlC98aGBgYGBgQRa0YV6exsDAwMBgLOrDwMDAwMSAB+CVZEThGZ85g8wFAN/QB7YQnSO3AAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: in.png -background white -shear '%[fx:2*w+6]x10' PNG32:out.png.
const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAGCAYAAAARx7TFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcKHykTc4jIAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6NDErMDA6MDDeSw99AAAAvklEQVQI113BsU7CQACA4f/oXbW0GtQ0tYMhhAUdgLXGyUFX3pNEV114ARJ0YWkaSIMxMTW1JRhbaD0nFr9PaK31bhmyeX4AoKgbWI6F8i+w70YASIAynLM3jnweFx7dc8FV8sF9cIz8zb+o3mMAfiqDydsZWal4yU54fUpp+yZS2A5WcEudJsymn8TfNhgNhDJxW5KboYMUUnHQ6wOQFxlumJBmWxCC64GDd6oQWmvNP+m6IlqVHDUNLjuH/AGxAD+epxl/OQAAAABJRU5ErkJggg==", "base64"));

for (const mode of ["command", "retained", "buffered", "sync", "mogrify"] as const) {
    it.each(["20x10", "%[fx:2*w+6]x10", "%[skew]", "%[option:skew]", "%[image-skew]"])(`expands shear geometry %s (${mode})`, async geometry => {
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const options = ["-background", "white", "-set", "option:skew", "20x10", "-set", "image-skew", "20x10", "-shear", geometry];
        const args = mode === "mogrify" ? [...options, "in.png"] : ["in.png", ...options, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile(mode === "mogrify" ? "/in.png" : "/out.png"));
        expect([output.width, output.height]).toEqual([9, 6]);
        expect(output.data).toEqual(native.data);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`expands shear against each image and captures options at each operation (${mode})`, async () => {
        const outputs = [];
        for (const expressions of [false, true]) {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const first = ["-shear", expressions ? "%[fx:2*w+6]x10" : "20x10"];
            const second = ["-shear", expressions ? "%[fx:2*w+6]x10" : "24x10"];
            const args = ["-background", "white", "-size", "7x5", "xc:red", ...(expressions ? [] : first),
                "(", "-size", "9x4", "xc:blue", ...(expressions ? [] : second), ")", ...(expressions ? first : []),
                "-set", "option:skew", "10x0", "-shear", expressions ? "%[skew]" : "10x0",
                "-set", "option:skew", "0x10", "-shear", expressions ? "%[skew]" : "0x10", "+append", "PNG32:out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            outputs.push({ width: output.width, height: output.height, data: output.data });
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
}
