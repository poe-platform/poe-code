import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { settings: ["-background", "black"], alpha: [], geometry: "1x1+8+2", pixel: [0, 0, 0, 0] },
        { settings: ["-background", "red"], alpha: [], geometry: "1x1+8+2", pixel: [255, 0, 0, 0] },
        { settings: ["-background", "red"], alpha: ["-alpha", "off"], geometry: "1x1+8+2", pixel: [255, 0, 0, 255] },
        { settings: [], alpha: [], geometry: "1x1+8+2", pixel: [255, 255, 255, 0] },
        { settings: [], alpha: ["-alpha", "off"], geometry: "1x1+8+2", pixel: [255, 255, 255, 255] },
        { settings: ["-background", "black"], alpha: [], geometry: "1x1+6+2", pixel: [21, 21, 21, 255] },
    ])(`uses crop background $settings with $alpha at $geometry (${mode})`, async ({ settings, alpha, geometry, pixel }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Uint8Array.from({ length: 35 }, (_, i) => i + 1)]);
        const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        const args = ["/in.pgm", ...settings, "-crop", geometry, ...alpha, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const missed = geometry === "1x1+8+2";
        expect("stderr" in result ? result.stderr : stderr).toBe(missed ? `magick: geometry does not contain image '${geometry}'\n` : "");
        expect(result.exitCode).toBe(0);
        if (mode === "command" || mode === "retained") {
            files.clear();
            for (const { name } of await filesystem.readdir("/")) files.set(`/${name}`, await filesystem.readFile(`/${name}`));
        }
        expect([...files.keys()].sort()).toEqual(["/in.pgm", "/tile-00.png"]);
        const image = decodeImage(files.get("/tile-00.png")!);
        expect([image.width, image.height]).toEqual([1, 1]);
        expect(image.virtualCanvas).toEqual({ width: 7, height: 5, x: missed ? -1 : 6, y: missed ? -1 : 2 });
        expect([...image.data]).toEqual(pixel);
    });
}
