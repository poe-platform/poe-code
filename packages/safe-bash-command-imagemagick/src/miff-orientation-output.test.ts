import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const rgb = Uint8Array.from({ length: 144 }, (_, index) => (index * 67 + 19) % 256);
const input = new Uint8Array([...new TextEncoder().encode("P6\n8 6\n255\n"), ...rgb]);
const rgba = Uint8Array.from({ length: 192 }, (_, index) => index % 4 === 3 ? 255 : rgb[Math.floor(index / 4) * 3 + index % 4]!);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "default", setting: [], orientation: undefined },
        { name: "orient", setting: ["-orient", "RightTop"], orientation: 6 },
        { name: "image property", setting: ["-set", "orientation", "RightTop"], orientation: 6 },
        { name: "option", setting: ["-set", "option:orient", "RightTop"], orientation: 6 },
        { name: "property overriding tag", setting: ["-orient", "LeftBottom", "-set", "orientation", "RightTop"], orientation: 6 },
        { name: "deleted property", setting: ["-set", "orientation", "RightTop", "+set", "orientation"], orientation: undefined }
    ])(`${mode}: writes MIFF orientation from $name without rotating pixels`, async ({ setting, orientation }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...setting, mode === "command" ? "miff:-" : "/out.miff"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
        const image = decodeImage(output);
        expect(image).toMatchObject({ width: 8, height: 6 });
        expect(image.orientation).toBe(orientation);
        expect(image.data).toEqual(rgba);
        const header = new TextDecoder().decode(output.subarray(0, output.indexOf(26)));
        if (orientation) expect(header).toContain(setting.includes("orientation") ? "orientation={RightTop}\n" : "orientation=RightTop\n");
        else expect(header).not.toContain("orientation=");

        const reopened = new Map([["/out.miff", output]]);
        expect(runMagickCliSync(["/out.miff", "-format", "%wx%h %[orientation]", "info:"], reopened)).toMatchObject({
            exitCode: 0, stderr: "", stdout: `8x6 ${orientation ? "RightTop" : "Undefined"}`
        });
        expect(runMagickCliSync(["/out.miff", "-auto-orient", "/rotated.png"], reopened)).toMatchObject({ exitCode: 0, stderr: "" });
        const rotated = decodeImage(reopened.get("/rotated.png")!);
        expect(rotated).toMatchObject({ width: orientation ? 6 : 8, height: orientation ? 8 : 6 });
        const expected = new Uint8Array(rgba.length);
        for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
            const source = (y * 8 + x) * 4;
            const target = orientation ? (x * 6 + 5 - y) * 4 : source;
            expected.set(rgba.subarray(source, source + 4), target);
        }
        expect(rotated.data).toEqual(expected);
    });
}
