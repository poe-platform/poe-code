import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

it.each([
    ["0x2,0", [64, 128, 192, 255]],
    ["2,0", [64, 128, 192, 255]],
    ["+0X2,0", [64, 128, 192, 255]],
    ["-0x2,1", [191, 127, 63, 0]],
    ["0.5junk", undefined],
    ["0x2junk,0", undefined],
    ["0x,0", undefined],
    ["0b10,0", undefined],
    ["0o2,0", undefined],
    [",0", undefined],
] as const)("command: validates hexadecimal function coefficients %s", async (coefficients, expected) => {
    const stdout: number[] = [];
    const result = await createMagickCommand().execute({
        command: "magick",
        args: createCommandArguments(["xc:#20406080", "-function", "Polynomial", coefficients,
            "-depth", "8", "rgba:-"]).args,
        cwd: "/", env: {}, fs: createMemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(...bytes); } }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(expected ? 0 : 1);
    expect(stdout).toEqual(expected ?? []);
});
