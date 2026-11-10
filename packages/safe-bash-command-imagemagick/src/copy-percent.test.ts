import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
const cases = [
    [["-set", "option:src", "2x1", "-set", "option:dst", "+2+1"], "50x50%", "+2+1", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"],
    [[], "50%", "+2+1", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"],
    [[], "25x100%", "+1+0", "000a14ff000a14ff3c4650ff5a646eff78828cff78828cffb4bec8ffd2dce6ff"],
    [[], "2x1+0+0", "+2+1", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"],
    [[], "2x1", "+2+1", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"],
] as const;

for (const mode of ["command", "sync", "buffered", "retained"]) {
    it.each(cases)(`resolves copy dimensions against the image (${mode}): %j %s %s`, async (settings, geometry, offset, expected) => {
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = [...settings, "in.ppm", "-copy", geometry, offset, "PNG32:out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([4, 2]);
        expect(Buffer.from(image.data).toString("hex")).toBe(expected);
    });
}
