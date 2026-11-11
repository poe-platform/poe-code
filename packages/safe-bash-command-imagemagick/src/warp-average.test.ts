import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const alpha = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded as row-major RGBA8.
for (const mode of ["command", "convert", "retained", "buffered", "sync"] as const) {
    it.each([
        ["average", input, "-swirl", "105", 7, "967ee1a7560648149e5bc0613f7854fd1467cbce6350bb70d6359cface3ecff9"],
        ["average4", input, "-swirl", "105", 7, "967ee1a7560648149e5bc0613f7854fd1467cbce6350bb70d6359cface3ecff9"],
        ["average9", input, "-swirl", "105", 7, "31c340d143ec28a0f3ffe7e3f91b83c3db8c2af13b2cd7889ce4a962057169be"],
        ["average9", alpha, "-implode", "1.25", 7, "722fbd75f776a4be0b418976ef59e2bad50a4f50d5bfa7c2377611e3c32265fb"],
        ["average9", input, "-wave", "2x8", 11, "493cafd933cfa440e734250e5c1bd72abd9d07827d62e91e960241a75b8e0cac"],
        ["average16", input, "-swirl", "105", 7, "30d64a88d9164057d12fe0c04459facf314f97979061181a05a9bc57e3bd6556"],
        ["average16", alpha, "-implode", "1.25", 7, "6640b718a28e31fa26b59e1deb2d948b1d86e100cf45c02f0ac4eecdd6f650a1"]
    ] as const)(`${mode}: matches native average footprint %#`, async (method, source, option, geometry, height, hash) => {
        const files = new Map([["/in.png", source], ["/out.png", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const argv = ["/in.png", "-interpolate", method, option, geometry, "PNG32:/out.png"];
        let stdout = "", stderr = "";
        const result = mode === "command" || mode === "convert" ? {
            ...await (mode === "command" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode === "command" ? "magick" : "convert",
                args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }), stdout, stderr
        } : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "buffered" || mode === "sync"
            ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([9, height]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}

it.each(["AvErAgE4", "AvErAgE9", "AvErAgE16"])("accepts %s case-insensitively and resets with +interpolate", async method => {
    const files = new Map<string, Uint8Array>([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-swirl", "105", "PNG32:/default.png"], files).exitCode).toBe(0);
    expect(runConvertCliSync(["/in.png", "-interpolate", method, "+interpolate", "-swirl", "105", "PNG32:/out.png"], files).exitCode).toBe(0);
    expect(decodeImage(files.get("/out.png")!).data).toEqual(decodeImage(files.get("/default.png")!).data);
});
