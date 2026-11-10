import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ffffee00991177245384", "hex")]);
const mask = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from([0, 255, 0, 255, 0, 255])]);
// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 reference for all five cases.
const expected = "ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ffee00ffff00ff4080ff4080ff4080ff4080ff1177ff00ffff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080ff4080";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { selection: ["-write-mask", "/mask.pgm"], clear: false },
        { selection: ["-region", "2x1+0+0"], clear: false },
        { selection: ["-write-mask", "/mask.pgm"], clear: true },
        { selection: ["-region", "2x1+0+0"], clear: true },
        { selection: [], clear: false },
    ])(`${mode}: edits the entire arbitrarily rotated image ($selection, clear=$clear)`, async ({ selection, clear }) => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", "-background", "#204080", "-filter", "point", "-interpolate", "nearest",
            ...selection, "-rotate", "37", ...(clear ? ["+write-mask", "+read-mask", "+region"] : []),
            "-channel", "R", "-evaluate", "set", "100%", "+channel", "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
