import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAGCAIAAACepSOSAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NTg6MTUrMDA6MDDx+6G+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjU4OjE1KzAwOjAwgKYZAgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo1ODoxNSswMDowMNezON0AAAAsSURBVAjXY2SV5xfXF8aKGK8c24VTbnFuKk65IhEBnHKOu3fjlBNISsMlBwAJ+hfYVdXe4QAAAABJRU5ErkJggg==", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI: input.png -repage <page> -wave <amplitude>x6 PNG32:out.png.
// Expected geometry is read back from the saved PNG with identify -format '%wx%h %g'.
for (const mode of ["command", "retained", "buffered", "sync", "mogrify"] as const) {
    it.each([
        { page: "40x30+5+7", amplitude: 2, height: 10, canvas: { width: 40, height: 50, x: 5, y: 7 } },
        { page: "40x30+5+7", amplitude: -2, height: 10, canvas: { width: 40, height: 50, x: 5, y: 7 } },
        { page: "40x30+5+7", amplitude: 0, height: 6, canvas: { width: 40, height: 30, x: 5, y: 7 } },
        { page: "18x12-2-3", amplitude: 2, height: 10, canvas: { width: 18, height: 20, x: -2, y: -3 } },
        { page: "18x12-2-3", amplitude: -2, height: 10, canvas: { width: 18, height: 20, x: -2, y: -3 } },
        { page: "18x12-2-3", amplitude: 0, height: 6, canvas: { width: 18, height: 12, x: -2, y: -3 } },
        { page: "40x31+5+7", amplitude: 2, height: 10, canvas: { width: 40, height: 52, x: 5, y: 7 } },
        { page: "40x31+5+7", amplitude: 0.8, height: 7, canvas: { width: 40, height: 36, x: 5, y: 7 } },
        { page: "40x30+5+7", amplitude: 8, height: 22, canvas: { width: 40, height: 110, x: 5, y: 26 } },
        { page: "18x12-2-3", amplitude: 8, height: 22, canvas: { width: 18, height: 44, x: -2, y: -11 } },
    ])(`${mode}: scales wave page $page with amplitude $amplitude`, async ({ page, amplitude, height, canvas }) => {
        const files = new Map<string, Uint8Array>([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const options = ["-repage", page, "-wave", `${amplitude}x6`];
        const args = mode === "mogrify" ? [...options, "/input.png"] : ["/input.png", ...options, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")!
            : await filesystem.readFile(mode === "mogrify" ? "/input.png" : "/out.png"));
        expect([output.width, output.height]).toEqual([9, height]);
        expect(output.virtualCanvas).toEqual(canvas);
        if (amplitude === 0) expect(output.data).toEqual(decodeImage(input).data);
    });
}
