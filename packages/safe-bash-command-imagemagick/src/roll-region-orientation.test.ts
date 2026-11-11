import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete gray8 rasters from ImageMagick 7.1.2-35 Q16-HDRI, also used
// for equivalent EXIF orientations and inverse-transform round trips.
const rolled = "ffff0000ff00000000000000000000ffff0000ff";
const mirrored = "ff0000ffff00000000000000000000ff0000ffff";
const clockwise = "ff0000ffff0000ff0000000000000000ff0000ff";
const counterclockwise = "ff0000ff0000000000000000ff0000ffff0000ff";
const cases: { operations: string[]; gray: string; roll?: boolean }[] = [
    { operations: [], gray: rolled },
    { operations: ["-flip"], gray: rolled },
    { operations: ["-flop"], gray: mirrored },
    { operations: ["-rotate", "90"], gray: clockwise },
    { operations: ["-rotate", "180"], gray: mirrored },
    { operations: ["-rotate", "270"], gray: counterclockwise },
    { operations: ["-rotate", "-90"], gray: counterclockwise },
    { operations: ["-transpose"], gray: clockwise },
    { operations: ["-transverse"], gray: counterclockwise },
    { operations: ["-flop", "-flop"], gray: rolled },
    { operations: ["-rotate", "90", "-rotate", "270"], gray: rolled },
    ...([
        ["TopLeft", rolled], ["TopRight", mirrored], ["BottomRight", mirrored], ["BottomLeft", rolled],
        ["LeftTop", clockwise], ["RightTop", clockwise], ["RightBottom", counterclockwise], ["LeftBottom", counterclockwise],
    ] as const).map(([orientation, gray]) => ({ operations: ["-orient", orientation, "-auto-orient"], gray })),
    { operations: ["-flop"], roll: false, gray: "000000000000ffffff0000ffffff000000000000" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`keeps all wrapped region pixels through $operations (${mode})`, async ({ operations, gray, roll }) => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "5x4", "xc:black", "-region", "3x2+1+1",
            ...(roll === false ? [] : ["-roll", "+3+2"]), ...operations, "-negate", "+region", "-depth", "8", "gray:/output.gray"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/output.gray")! : await fs.readFile("/output.gray");
        expect(Buffer.from(output).toString("hex")).toBe(gray);
    });
}
