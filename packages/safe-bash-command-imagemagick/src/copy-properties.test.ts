import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
const cases = [
    ["2x1", "%[dst]"],
    ["%[src]", "+2+1"],
    ["%[src]", "%[dst]"],
    ["%[option:src]", "%[option:dst]"],
    ["%[fx:w/2]x%[fx:h/2]", "+%[fx:w/2]+%[fx:h/2]"],
    ["2x1+0+0", "+2+1"],
    ["2x1", "+2+1"],
] as const;
const expected = "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff";

for (const mode of ["command", "sync", "buffered", "retained"]) {
    it.each(cases)(`expands copy geometry properties (${mode}): %s %s`, async (geometry, offset) => {
        const files = new Map([["in.ppm", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const args = ["-set", "option:src", "2x1", "-set", "option:dst", "+2+1", "in.ppm", "-copy", geometry, offset, "PNG32:out"];
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
