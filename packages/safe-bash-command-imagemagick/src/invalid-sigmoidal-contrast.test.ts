import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        for (const existing of [false, true]) {
            it.each(["bogus", "5x40%junk", "x50%", "", "5xNaN", "5e", "5e,40%", "1.2.3", "+1+2"])(`${mode} ${option} rejects %s with existing output ${existing}`, async geometry => {
                const input = await sharp(Uint8Array.from(Array.from({ length: 15 }, (_, i) => (i + 1) * 10).flatMap(v => [v, v, v])), { raw: { width: 5, height: 3, channels: 3 } }).png().toBuffer();
                const original = await sharp(Uint8Array.from([7, 7, 7]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
                const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                if (existing) {
                    files.set("out.png", original);
                    await filesystem.writeFile("/out.png", original);
                }
                const args = ["input.png", option, geometry, "out.png"];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode).toBe(1);
                expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${option}'`);
                if (mode === "command" || mode === "retained") {
                    if (existing) expect(await filesystem.readFile("/out.png")).toEqual(original);
                    else await expect(filesystem.readFile("/out.png")).rejects.toThrow();
                } else expect(files.get("out.png")).toEqual(existing ? original : undefined);
            });
        }
    }
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["5x40%", "0b54b10cbaf7e3eb3f"],
        ["+5", "073e9908a3f3d7e22d"],
        ["-5", "0f50911198e7c3d041"],
        ["5e-1x40%", "0f50911199e7c4d041"],
        ["5e+1x40%", "0003ff00ffffffff00"]
    ])(`${mode} preserves native sigmoidal contrast pixels for %s`, async (geometry, expected) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const files = new Map([["a.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        const args = ["a.ppm", "-sigmoidal-contrast", geometry, "-depth", "8", "rgb:out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
