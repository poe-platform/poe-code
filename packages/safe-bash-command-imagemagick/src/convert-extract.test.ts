import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference: a 4x3 RGB PNG with distinct pixels.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const original = Array.from({ length: 12 }, (_, i) => [20 * i, 10 + i, 80 - i, 255]).flat();
const cropped = [1, 2, 5, 6].flatMap(i => original.slice(i * 4, i * 4 + 4));
const page = { width: 4, height: 3, x: 1, y: 0 };
const cases = [
    { args: ["-extract", "2x2+1+0", "/in.png"], size: [2, 2], rgba: cropped, page },
    { args: ["-extract", "2x2", "/in.png"], size: [2, 2], rgba: [33, 12, 78, 255, 71, 14, 76, 255, 149, 17, 73, 255, 187, 19, 71, 255] },
    { args: ["-extract", "2x2+1+0", "+extract", "/in.png"], size: [4, 3], rgba: original },
    { args: ["/in.png", "-extract", "2x2+1+0"], size: [4, 3], rgba: original },
    { args: ["+extract", "/in.png"], size: [4, 3], rgba: original },
    { args: ["/in.png", "-crop", "2x2+1+0"], size: [2, 2], rgba: cropped, page },
    { args: ["-extract", "2x2+1+0", "--", "/in.png"], size: [2, 2], rgba: cropped, page },
    { args: ["/in.png", "-extract", "2x2+1+0", "/in.png", "+extract", "/in.png", "+append"], size: [10, 3], rgba: [
        ...original.slice(0, 16), ...cropped.slice(0, 8), ...original.slice(0, 16),
        ...original.slice(16, 32), ...cropped.slice(8), ...original.slice(16, 32),
        ...original.slice(32), ...Array(8).fill(255), ...original.slice(32),
    ], page: { width: 4, height: 3, x: 0, y: 0 } },
    { args: ["-extract", "2x2+1+0", "/in.png[1x1+0+0]"], size: [1, 1], rgba: original.slice(0, 4), page: { width: 4, height: 3, x: 0, y: 0 } },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of cases) {
        it(`${mode} conversion applies ${fixture.args.join(" ")}`, async () => {
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
            const args = [...fixture.args, "/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual(fixture.size);
            expect([...output.data]).toEqual(fixture.rgba);
            expect(output.virtualCanvas).toEqual(fixture.page);
        });
    }

    for (const options of [["-extract"], ["-extract", "bogus"], ["-extract", ""]]) {
        it(`${mode} conversion rejects ${JSON.stringify(options)} without overwriting output`, async () => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
            const filesystem = new MemoryFileSystem();
            for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
            const args = ["/in.png", ...options, "/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("argument for option '-extract'");
            expect(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(keep);
        });
    }
}
