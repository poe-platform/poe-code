import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        for (const existing of [false, true]) {
            it.each(["bogus", "5x40%junk", "x50%", "", "5xNaN"])(`${mode} ${option} rejects %s with existing output ${existing}`, async geometry => {
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
