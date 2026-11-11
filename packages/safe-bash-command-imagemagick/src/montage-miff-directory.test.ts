import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([{ options: [] }, { options: ["-thumbnail", "100%"] }, { options: ["-reverse"] }, { options: ["-geometry", "4x3+2+1"] }])(`${mode} saves montage geometry and ordered directory: %j`, async ({ options }) => {
        const files = new Map([
            ["a.ppm", new TextEncoder().encode("P3\n2 1\n255\n255 0 0 255 0 0\n")],
            ["b.ppm", new TextEncoder().encode("P3\n1 2\n255\n0 0 255 0 0 255\n")]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = ["montage", ...files.keys(), "-depth", "8", "-mode", "Concatenate", "-tile", "2x1", ...options, "result.miff"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/result.miff") : files.get("result.miff")!;
        const directory = options.includes("-reverse") ? ["b.ppm", "a.ppm"] : ["a.ppm", "b.ppm"];
        const fixed = options.includes("-geometry");
        const geometry = fixed ? "8x5+0+0" : "2x2+0+0";
        expect(Buffer.from(bytes).toString("latin1")).toContain(`montage=${geometry}\n`);
        expect(Buffer.from(bytes).toString("latin1")).toContain(`:\x1a${directory.join("\xff")}\xff\x00`);
        expect(decodeImage(bytes)).toMatchObject({ width: fixed ? 16 : 3, height: fixed ? 5 : 2, montage: { geometry, directory } });
        if (nativeAvailable) {
            const native = spawnSync("magick", ["identify", "-verbose", "miff:-"], { input: bytes });
            // Verbose identify tries to reopen directory entries on disk; inputs here live in memory.
            expect(native.stdout.toString()).toContain(`Montage: ${geometry}`);
            expect(native.stdout.toString()).toContain("Directory:");
            const pixels = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
            expect(pixels.status).toBe(0);
            expect(pixels.stdout).toEqual(Buffer.from(decodeImage(bytes).data));
        }
    });
}
