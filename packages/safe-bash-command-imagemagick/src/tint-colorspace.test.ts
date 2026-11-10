import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: translucent source and fill; raw RGBA output.
const cases = [
    ["HSL", false, [0x40, 0x80, 0xa0, 0x80]],
    ["HSL", true, [0x24, 0x31, 0x37, 0x80]],
    ["Lab", false, [0x40, 0x80, 0xa0, 0x80]],
    ["Lab", true, [0x00, 0xf6, 0xff, 0x80]],
    ["sRGB", true, [0x40, 0x47, 0x61, 0x80]],
] as const;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`${mode}: preserves %s tint=%s through conversion to sRGB`, async (space, tint, expected) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = ["xc:#4080a080", "-colorspace", space,
            ...(tint ? ["-fill", "#bf605040", "-tint", "60%"] : []),
            "-colorspace", "sRGB", "-depth", "8", "rgba:/out.rgba"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
        expect([...output]).toEqual(expected);
    });
}
