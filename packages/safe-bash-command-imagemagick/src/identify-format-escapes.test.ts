import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand } from "./index.js";

for (const mode of ["identify", "magick identify", "magick info"])
it.each([
    { format: "A\\tB", expected: "AtB" },
    { format: "A\\qB", expected: "AqB" },
    { format: "A\\aB", expected: "AaB" },
    { format: "A\\1B", expected: "A1B" },
    { format: "A\\bB", expected: "AbB" },
    { format: "A\\fB", expected: "AfB" },
    { format: "A\\\nB", expected: "AB" },
    { format: "A\\nB", expected: "A\nB" },
    { format: "A\\rB", expected: "A\rB" },
    { format: "A\\\\B", expected: "A\\B" },
    { format: "A\\\\nB", expected: "A\\nB" },
    { format: "A\\%wB", expected: "A%wB" },
    { format: "A\\%[width]B", expected: "A%[width]B" },
    { format: "A%%B", expected: "A%B" },
    { format: "A\\", expected: "A\\" },
    { format: "A\\q%wB", expected: "Aq3B" }
])(`${mode} matches native format escape bytes: $format`, async ({ format, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", new Uint8Array([
        ...new TextEncoder().encode("P6\n3 2\n255\n"),
        255, 0, 0, 0, 255, 0, 0, 0, 255,
        255, 0, 0, 0, 255, 0, 0, 0, 255
    ]));
    const command = mode === "identify" ? createIdentifyCommand() : createMagickCommand();
    const argumentValues = createCommandArguments(mode === "magick info"
        ? ["tile.ppm", "-format", format, "info:"]
        : [...(mode === "magick identify" ? ["identify"] : []), "-format", format, "tile.ppm"]);
    const stdout: number[] = [], stderr: number[] = [];
    const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr.push(...bytes); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([...new TextEncoder().encode(expected)]);
});
