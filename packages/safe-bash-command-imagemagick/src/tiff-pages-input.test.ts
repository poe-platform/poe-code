import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`reads TIFF pages before selection, append and identify (${mode})`, async () => {
        const files = new Map<string, Uint8Array>();
        // Native ImageMagick: two uncompressed pages with distinct geometry and metadata.
        files.set("pages.tiff", Uint8Array.from(Buffer.from("SUkqALAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAD//wAAAAAXAP4ABAABAAAAAgAAAAABAwABAAAABwAAAAEBAwABAAAABAAAAAIBAwADAAAA6gEAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAAA4BAgAGAAAANgIAABEBBAABAAAACAAAABIBAwABAAAACAAAABUBAwABAAAAAwAAABYBAwABAAAABAAAABcBBAABAAAAqAAAABoBBQABAAAAygEAABsBBQABAAAA0gEAABwBAwABAAAAAQAAAB0BAgAGAAAAMAIAAB4BBQABAAAA2gEAAB8BBQABAAAA4gEAACgBAwABAAAAAwAAACkBAwACAAAAAAACAD4BBQACAAAAIAIAAD8BBQAGAAAA8AEAAJYCAABuAAAAAQAAAFoAAAABAAAAAAAAAAEAAAAAAAAAAQAAABAAEAAQAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIABBbHBoYQBGaXJzdAAAAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8AAAAA//8XAP4ABAABAAAAAgAAAAABAwABAAAAAwAAAAEBAwABAAAABQAAAAIBAwADAAAA0AMAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAAA4BAgAHAAAAHAQAABEBBAABAAAAPAIAABIBAwABAAAACAAAABUBAwABAAAAAwAAABYBAwABAAAABQAAABcBBAABAAAAWgAAABoBBQABAAAAsAMAABsBBQABAAAAuAMAABwBAwABAAAAAQAAAB0BAgAFAAAAFgQAAB4BBQABAAAAwAMAAB8BBQABAAAAyAMAACgBAwABAAAAAwAAACkBAwACAAAAAQACAD4BBQACAAAABgQAAD8BBQAGAAAA1gMAAAAAAABuAAAAAQAAAFoAAAABAAAAAAAAAAEAAAAAAAAAAQAAABAAEAAQAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIABCZXRhAABTZWNvbmQA", "base64")));
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/pages.tiff", files.get("pages.tiff")!);
        const run = async (args: string[]) => {
            if (mode === "command") {
                let stdout = "", stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                return { ...result, stdout, stderr };
            }
            return mode === "sync" ? runMagickCliSync(args, files) : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        };
        const read = async (path: string) => decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile(`/${path}`) : files.get(path)!);
        expect(await run(["pages.tiff[1]", "second.png"])).toMatchObject({ exitCode: 0, stderr: "" });
        const second = await read("second.png");
        expect([second.width, second.height, ...second.data.slice(0, 4)]).toEqual([3, 5, 0, 0, 255, 255]);
        expect(second.properties?.comment).toBe("Second");
        expect(await run(["pages.tiff[0]", "first.png"])).toMatchObject({ exitCode: 0 });
        const first = await read("first.png");
        expect([first.width, first.height, ...first.data.slice(0, 4)]).toEqual([7, 4, 255, 0, 0, 255]);
        expect(first.properties?.comment).toBe("First");
        expect(await run(["pages.tiff", "+append", "joined.png"])).toMatchObject({ exitCode: 0 });
        const joined = await read("joined.png");
        expect([joined.width, joined.height]).toEqual([10, 5]);
        const identified = await run(["identify", "pages.tiff"]);
        expect(identified.exitCode).toBe(0);
        expect(identified.stdout).toContain("pages.tiff[0] TIFF 7x4");
        expect(identified.stdout).toContain("pages.tiff[1] TIFF 3x5");
        expect(await run(["pages.tiff[2]", "invalid.png"])).toMatchObject({ exitCode: 1 });
        expect(await run(["identify", "-format", "%s:%wx%h:%c\\n", "pages.tiff"])).toMatchObject({ exitCode: 0, stdout: "0:7x4:First\n1:3x5:Second\n", stderr: "" });
    });
}
