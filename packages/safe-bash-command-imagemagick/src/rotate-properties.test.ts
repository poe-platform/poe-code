import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADCAIAAADQoYKSAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAiAN0ARLai5PEAAAAHdElNRQfqCwcKHgE/3RFzAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMwOjAxKzAwOjAwk4vz2gAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMDowMSswMDowMOLWS2YAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzA6MDErMDA6MDC1w2q5AAAAIUlEQVQI12NkmPmfgYGBgYFhd7sjAwwwMWADjLsVHDBFAdApBDuKBtksAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: in.png -rotate '%[fx:w*10+20]' PNG32:out.png.
const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAAHCAYAAADNufepAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAiAN0ARLai5PEAAAAHdElNRQfqCwcKHg/YZTx0AAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMwOjAxKzAwOjAwk4vz2gAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMDowMSswMDowMOLWS2YAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzA6MTUrMDA6MDCNJk40AAAAJUlEQVQI12PYreDwn2Hm//8MM///Z2JAAigcxt0KDv+xyuDmAADLbwlu2r7+TgAAAABJRU5ErkJggg==", "base64"));

for (const mode of ["command", "retained", "buffered", "sync", "mogrify"] as const) {
    it.each(["90", "%[fx:w*10+20]", "%[fx:45*2]", "%[turn]", "%[image-angle]", "%[fx:w*10+20]>", "invalid", "%[bad-angle]"])(`expands rotation angle %s (${mode})`, async angle => {
        const keep = Buffer.from("KEEP");
        const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        await filesystem.writeFile("/out.png", keep);
        const options = ["-set", "option:turn", "90", "-set", "image-angle", "90", "-set", "bad-angle", "invalid", "-rotate", angle];
        const args = mode === "mogrify" ? [...options, "in.png"] : ["in.png", ...options, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        const invalid = angle === "invalid" || angle === "%[bad-angle]";
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(invalid ? 1 : 0);
        const output = mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile(mode === "mogrify" ? "/in.png" : "/out.png");
        if (invalid) {
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid rotation angle");
            expect([...output]).toEqual([...(mode === "mogrify" ? input : keep)]);
        } else {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([3, 7]);
            expect(image.data).toEqual(native.data);
        }
    });

    it.each(["-90", "360", "30", "30<"])(`matches literal rotation %s after expansion (${mode})`, async angle => {
        const outputs = [];
        for (const value of [angle, "%[turn]"]) {
            const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const options = ["-set", "option:turn", angle, "-rotate", value];
            const args = mode === "mogrify" ? [...options, "in.png"] : ["in.png", ...options, "PNG32:out.png"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(args, files) : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            const output = mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile(mode === "mogrify" ? "/in.png" : "/out.png");
            const image = decodeImage(output);
            outputs.push({ width: image.width, height: image.height, pixels: image.data });
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
}
