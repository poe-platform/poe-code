import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Two one-bit PNG palette entries: gray (32,32,32) and blue (40,90,140).
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAABlBMVEUgICAoWoxRPFFOAAAACklEQVR4nGNwAAAAQgBBKTf07wAAAABJRU5ErkJggg==", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI, depth 8 RGBA output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-contrast", "-cycle", "1"], expected: "295c90ff151515ff" },
        { options: ["+contrast", "-cycle", "1"], expected: "275888ff2b2b2bff" },
        { options: ["-cycle", "1"], expected: "285a8cff202020ff" },
        { options: ["-contrast"], expected: "151515ff295c90ff" },
        { options: ["+contrast"], expected: "2b2b2bff275888ff" },
        { options: ["-cycle", "1", "-contrast"], expected: "295c90ff151515ff" },
    ])(`${mode}: preserves palette contrast with $options`, async ({ options, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", png);
        const args = ["/in.png", ...options, "-depth", "8", "rgba:/out"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const actual = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(actual).toString("hex")).toBe(expected);
    });
}
