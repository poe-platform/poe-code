import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: magick in.png -shear 20x10 PNG32:out.png.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAzAJkARJyxf98AAAAHdElNRQfqCwcKHxfSEpVjAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6MjMrMDA6MDCPuxfTAAAAOUlEQVQI12O8ayDQwIAGlC98aGBgYGBgQRa0YV6exsDAwMBgLOrDwMDAwMSAB+CVZEThGZ85g8wFAN/QB7YQnSO3AAAAAElFTkSuQmCC", "base64");
const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAGCAYAAAARx7TFAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAzAJkARJyxf98AAAAHdElNRQfqCwcKHxfSEpVjAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjMxOjIzKzAwOjAwqfOOsAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDozMToyMyswMDowMNiuNgwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MzE6MjMrMDA6MDCPuxfTAAAAs0lEQVQI1zXOTY/BQACA4bdjjJTxFSyJlMienRwkzv6kX+QoEScku3twoVpCt18zuoeN5xc8zmy1LIZhwuIYAGCKMlZZLvUK6882ABJgfP3lbRMs2IZzatrHjyIa3h6pE0PvkQGQvxSHx5TYas5pk/woUPUQGasSW69BM87JTh5+9kEhHIwQSDdCD76RVjh8dasA3MyIZ5BjE5cC0P0fyu7z//TWmuxoTXaYtEp671BSKQB/n3lEqnyjsOUAAAAASUVORK5CYII=", "base64"));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { background: undefined, stored: true },
        { background: "#339944", stored: true },
        { background: "white", stored: true },
        { background: undefined, stored: false }
    ])(`shears with background=$background stored=$stored (${mode})`, async ({ background, stored }) => {
        const decoded = decodeImage(input);
        expect(decoded.backgroundColor).toEqual({ r: 51, g: 153, b: 68, a: 255 });
        const { backgroundColor: ignoredBackground, ...withoutBackground } = decoded;
        const bytes = stored ? input : encodeImage(withoutBackground, { format: "png" }).data;
        if (!stored) expect(decodeImage(bytes).backgroundColor).toBeUndefined();
        const files = new Map([["/in.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", bytes);
        const args = ["/in.png", ...(background ? ["-background", background] : []), "-shear", "20x10", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, 6]);
        const white = background === "white" || !stored;
        expect([...output.data.slice(0, 4)]).toEqual(white ? [255, 255, 255, 255] : [51, 153, 68, 255]);
        if (!white) expect(output.data).toEqual(native.data);
    });
}
