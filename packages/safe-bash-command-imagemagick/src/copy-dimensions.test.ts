import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI on a 4x2 RGB image.
const cases = [
    ["1", "+1+0", "000a14ff000a14ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
    ["1", "+2+1", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ffd2dce6ff"],
    ["3", "+0+0", undefined],
    ["1x", "+1+0", "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
    ["1x+0+0", "+1+0", "000a14ff000a14ff3c4650ff5a646eff78828cff78828cffb4bec8ffd2dce6ff"],
    ["1x1", "+1+0", "000a14ff000a14ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
    ["2x1", "+1+0", "000a14ff000a14ff000a14ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
] as const;

for (const mode of ["command", "sync", "buffered", "retained"]) for (const output of ["PNG32:out", "info:out"]) {
    it.each(cases)(`uses native copy dimensions (${mode}, ${output}): %s %s`, async (geometry, offset, expected) => {
        const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = ["in.ppm", "-copy", geometry, offset, "-format", "%wx%h", output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(expected === undefined ? 1 : 0);
        const error = "stderr" in result ? result.stderr : stderr;
        if (expected === undefined) expect(error).toContain("geometry does not contain image");
        else expect(error).toBe("");
        const bytes = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
        if (expected === undefined) expect(new TextDecoder().decode(bytes)).toBe("KEEP");
        else if (output === "info:out") expect(new TextDecoder().decode(bytes)).toBe("4x2");
        else {
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual([4, 2]);
            expect(Buffer.from(image.data).toString("hex")).toBe(expected);
        }
    });
}
