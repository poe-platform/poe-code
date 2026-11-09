import { createHash } from "node:crypto";
import { patternFixtures } from "./builtin-patterns-fixtures.js";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each(patternFixtures)(`matches native %s (${mode})`, async (name, tileWidth, tileHeight, ...hashes) => {
      for (const [index, size] of [undefined, [32, 17], [67, 35]].entries()) {
        const [width, height] = size ?? [tileWidth, tileHeight];
        const seed = new TextEncoder().encode("keep");
        const files = new Map([["/out.png", seed]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", seed);
        const argv = [...(size ? ["-size", `${width}x${height}`] : []), `pattern:${name}`, "/out.png"];
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
            });
            expect(result.exitCode).toBe(0);
        } else {
            expect(await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" }))
                .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const image = decodeImage(mode === "buffered" ? files.get("/out.png")! : await filesystem.readFile("/out.png"));
        expect([image.width, image.height]).toEqual([width, height]);
        expect(createHash("sha256").update(image.data).digest("hex")).toBe(hashes[index]);
      }
    });
}

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each(["", "not-a-pattern", "missing", "constructor", "__proto__"])(`rejects unknown pattern %s without overwriting output (${mode})`, async (name) => {
        const seed = new TextEncoder().encode("keep");
        const files = new Map([["/out.png", seed]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out.png", seed);
        const argv = ["-size", "32x17", `pattern:${name}`, "/out.png"];
        let exitCode: number;
        if (mode === "command") {
            const args = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, fs: filesystem
            });
            exitCode = result.exitCode;
        } else {
            const result = await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            expect(result.stderr).toContain("unrecognized image format");
        }
        expect(exitCode).not.toBe(0);
        expect(mode === "buffered" ? files.get("/out.png") : await filesystem.readFile("/out.png")).toEqual(seed);
    });
}

it("accepts case-insensitive pattern names", async () => {
    const files = new Map<string, Uint8Array>();
    expect((await runMagickCli(["-size", "32x17", "PATTERN:VeRtIcAl", "/out.png"], files)).exitCode).toBe(0);
    expect(createHash("sha256").update(decodeImage(files.get("/out.png")!).data).digest("hex"))
        .toBe(patternFixtures.find(([name]) => name === "vertical")![4]);
});
