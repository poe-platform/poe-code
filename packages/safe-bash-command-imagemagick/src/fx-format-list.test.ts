import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const first = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n0 0 0 255 255 255 128 64 32\n");
// Native ImageMagick PNG24: -size 2x1 xc:#406080.
const second = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMTBUMDE6NDk6MTQrMDA6MDDi8elvAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTEwVDAxOjQ5OjE0KzAwOjAwk6xR0wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0xMFQwMTo0OToxNCswMDowMMS5cAwAAAAPSURBVAjXY3RIaGBgYAAABW4BIrTOzOIAAAAASUVORK5CYII=", "base64");
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function run(argv: string[]) {
        const files = new Map([["first.ppm", first], ["second.png", second]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        if (mode === "sync") return runMagickCliSync(argv, files);
        if (mode !== "command") return runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        return { ...result, stdout, stderr };
    }
    it.each(["v.r", "u[1].r", "u[-1].r", "u.r+v.r", "r"])(`${mode}: formats the full conversion list with %s`, async expression => {
        const result = await run(["first.ppm", "second.png", "-format", `%[fx:${expression}]`, "info:"]);
        expect(result).toMatchObject({ exitCode: 0, stdout: expression === "r" ? "10.25098" : expression === "u.r+v.r" ? "1.250981.25098" : "0.250980.25098", stderr: "" });
    });
    it.each(["v", "v.r", "u[1].r"])(`${mode}: rejects missing image for %s`, async expression => {
        const result = await run(["first.ppm", "-format", `%[fx:${expression}]`, "info:"]);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(expression.startsWith("v") ? "fewer than two images" : "ImgNum 1 bad for ImgListLen 1");
    });
    it(`${mode}: identify inputs remain independent and preserve surrounding text`, async () => {
        const result = await run(["identify", "-format", "X%[fx:v]Y", "first.ppm", "second.png"]);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("XYXY");
        expect(result.stderr).toContain("fewer than two images");
    });
}
