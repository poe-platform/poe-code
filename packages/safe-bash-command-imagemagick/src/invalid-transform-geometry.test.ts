import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-roll", "-chop", "-border", "-shave"]) {
        for (const existing of [false, true]) {
            it.each(["garbage", "bogus", "2/1", "1,2", "1/2+1+2", "1,2+1+2", "+1+2garbage", "", ...(option === "-border" ? ["+2+1", "-1", "x"] : [])])(`${mode} ${option} rejects %s with existing output ${existing}`, async geometry => {
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

for (const option of ["-roll", "-chop"]) {
    it.each(["1:2+1+2", "+1,+2"])(`${option} accepts valid separator geometry %s`, async geometry => {
        const filesystem = new MemoryFileSystem();
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["-size", "5x3", "xc:gray", option, geometry, "out.png"]).args,
            cwd: "/", env: {}, fs: filesystem, stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe(option === "-chop" && geometry === "+1,+2" ? `magick: geometry does not contain image '${geometry}'\n` : "");
        expect((await filesystem.readFile("/out.png")).length).toBeGreaterThan(0);
    });
}
