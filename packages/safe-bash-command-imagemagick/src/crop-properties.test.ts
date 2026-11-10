import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { settings: [], geometry: "%[fx:w-2]x%[fx:h-1]+1+1", width: 5, height: 4 },
        { settings: ["-set", "option:box", "3x2+1+1"], geometry: "%[option:box]", width: 3, height: 2 },
        { settings: [], geometry: "5x4+1+1", width: 5, height: 4 },
        { settings: [], geometry: "3x2+1+1", width: 3, height: 2 },
    ])(`expands crop $geometry before selecting pixels (${mode})`, async ({ settings, geometry, width, height }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...Uint8Array.from({ length: 35 }, (_, i) => i + 1)]);
        const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        const args = ["/in.pgm", ...settings, "-crop", geometry, "/tile-%02d.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        if (mode === "command" || mode === "retained") {
            files.clear();
            for (const { name } of await filesystem.readdir("/")) files.set(`/${name}`, await filesystem.readFile(`/${name}`));
        }
        expect([...files.keys()].sort()).toEqual(["/in.pgm", "/tile-00.png"]);
        const image = decodeImage(files.get("/tile-00.png")!);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(image.virtualCanvas).toEqual({ width: 7, height: 5, x: 1, y: 1 });
        expect([...image.data].filter((_, i) => i % 4 === 0)).toEqual(
            Array.from({ length: width * height }, (_, i) => 9 + Math.floor(i / width) * 7 + i % width),
        );
    });
}
