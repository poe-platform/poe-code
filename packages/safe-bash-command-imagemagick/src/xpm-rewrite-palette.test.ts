import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 preserves all three opaque entries when rewriting XPM.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ["red", "bbb", [1, 1, 1], "ffffffffffffffffffffffff"],
        ["blue", "ab.", [0, 1, 2], "0000ffffffffffff0000ffff"],
        ["red", "ab.", [0, 1, 2], "0000ffffffffffffff0000ff"]
    ] as const)(`preserves palette identity through XPM output (${mode}, %s, %s)`, async (first, row, indices, cycled) => {
        const input = new TextEncoder().encode(`/* XPM */\nstatic char *icon[] = {"3 1 3 1", "a c ${first}", "b c blue", ". c white", "${row}"};`);
        const files = new Map<string, Uint8Array>([["/icon.xpm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/icon.xpm", input);
        const args = ["/icon.xpm", "xpm:-"];
        let output: Uint8Array, stderr = "";
        if (mode === "command") {
            const chunks: Uint8Array[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(result.exitCode).toBe(0);
            output = Buffer.concat(chunks);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            stderr = result.stderr;
            output = result.stdoutBytes!;
        }
        expect(stderr).toBe("");
        const decoded = decodeImage(output);
        expect(decoded.data).toEqual(decodeImage(input).data);
        expect(decoded.indexedColors).toEqual([first === "red" ? 0xffff0000 : 0xff0000ff, 0xff0000ff, 0xffffffff]);
        expect(decoded.pngIndices).toEqual(Uint8Array.from(indices));
        files.set("/saved.xpm", output);
        expect(runConvertCliSync(["/saved.xpm", "-cycle", "1", "-depth", "8", "rgba:/cycled"], files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(files.get("/cycled")!).toString("hex")).toBe(cycled);
    });
}
