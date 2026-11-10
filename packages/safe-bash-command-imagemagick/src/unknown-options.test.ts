import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const retained of [false, true]) {
    for (const option of ["-unknown-thing", "+unknown-thing"]) {
        it.each([false, true])(`rejects ${option}, retained=${retained}, existing output=%s`, async existing => {
            const bytes = await sharp(Uint8Array.of(100, 150, 200, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", bytes);
            if (existing) {
                files.set("out.png", bytes);
                await filesystem.writeFile("/out.png", bytes);
            }
            const result = await runConvertCli(["input.png", option, "value", "out.png"], retained ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(11);
            expect(result.stderr).toContain(`unrecognized option '${option}'`);
            expect(result.stdout).toBe("");
            expect(result.stdoutBytes).toBeUndefined();
            if (retained) {
                expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(existing ? ["input.png", "out.png"] : ["input.png"]);
                if (existing) expect(await filesystem.readFile("/out.png")).toEqual(bytes);
            } else {
                expect(files.get("out.png")).toEqual(existing ? bytes : undefined);
            }
        });
    }
    it(`accepts literal option-like filenames after --, retained=${retained}`, async () => {
        const bytes = await sharp(Uint8Array.of(100, 150, 200, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["-unknown-thing", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/-unknown-thing", bytes);
        const result = await runConvertCli(["--", "-unknown-thing", "out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
    });
}

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const output of ["rgb:out", "info:out"]) {
        it.each(["-minify", "-not-a-real-option", "-magnify"])(`matches native conversion status and output for %s (${mode}, ${output})`, async option => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["out", original]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const args = ["xc:red", option, "-depth", "8", ...(output === "info:out" ? ["-format", "%w,%h"] : []), output];
            let stdout = "", stderr = "";
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            const success = option === "-magnify";
            expect(result.exitCode).toBe(success ? 0 : 11);
            expect(result.stdout).toBe("");
            if (success) expect(result.stderr).toBe("");
            else expect(result.stderr).toContain(`unrecognized option '${option}'`);
            const expected = success ? output === "rgb:out" ? Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0) : new TextEncoder().encode("2,2") : original;
            expect(mode === "buffered" || mode === "sync" ? files.get("out") : await filesystem.readFile("/out")).toEqual(expected);
        });
    }
}
