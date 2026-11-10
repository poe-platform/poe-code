import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete big-endian RGBA16 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    ["Atop", "09b50f9e1a733333"],
    ["Overlay", "61f5481368d4d126"],
    ["ColorBurn", "3e2b311c5172d126"],
    ["Bumpmap", "07f70c9412730721"],
    ["Colorize", "1a2c5d6fc5d78888"],
    ["DarkenIntensity", "255c47a77ce10000"],
    ["DivideDst", "ba4dffffffffd126"],
    ["Dissolve", "654c6ae5a84ed126"],
    ["DstOver", "748a4dee669cd126"],
    ["HardMix", "3e2b311cab04d126"],
    ["Hue", "3b5a58da86a58888"],
    ["Intensity", "39395a5a848485c8"],
    ["LightenIntensity", "49498c8cf4f40001"],
    ["LinearDodge", "a68f8aa8b51ad126"],
    ["Luminize", "68568977b3a18888"],
    ["MinusSrc", "42841134038cd126"],
    ["Modulate", "0b8e0b8e187a3333"],
    ["ModulusAdd", "6dc1662e9a213e3e"],
    ["ModulusSubtract", "0c1645d22beb2d2d"],
    ["PinLight", "76604daba597d126"],
    ["Saturate", "155260dac0fd8888"],
    ["VividLight", "53a443fbab04d126"],
    ["Over", "654c6ae5a84ed126"],
    ["DstAtop", "2614292f41088282"]
] as const;

for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-flatten"], ["-mosaic"]])
for (const depth of [8, 16])
it.each(cases)(`${route}: ${operation.join(" ")} %s retains fractional samples through ${depth}-bit output`, async (mode, hex) => {
    const argv = ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482", "-compose", mode,
        ...operation, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    const expected = depth === 16 ? Buffer.from(hex, "hex") : Uint8Array.from({ length: 4 }, (_, channel) =>
        Math.round(Buffer.from(hex, "hex").readUInt16BE(channel * 2) / 257));
    expect(Buffer.from(bytes)).toEqual(Buffer.from(expected));
});
