import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ppm = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from([
    12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239,
])]);

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA samples, including the gap.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [index, direction] of ["+smush", "-smush"].entries())
it.each([
    { name: "second frame selection", first: [], second: ["-channel", "R"], edit: ["-negate"],
        expected: ["f3e4d7ffccc3b8ffaea59bfff3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff8c786eff5f4c41ff362310ff", "f3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff000000ff000000ff000000fff3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff"] },
    { name: "first frame selection", first: ["-channel", "R"], second: [], edit: ["-negate"],
        expected: ["f3ffffffccffffffaefffffff3ffffffccffffffaeffffff8cffffff5fffffff36ffffff8cffffff5fffffff36ffffff", "f3ffffffccffffffaeffffff8cffffff5fffffff36ffffff00ffffff00ffffff00fffffff3ffffffccffffffaeffffff8cffffff5fffffff36ffffff"] },
    { name: "different frame selections", first: ["-channel", "G"], second: ["-channel", "R"], edit: ["-negate"],
        expected: ["ffe4ffffffc3ffffffa5ffffffe4ffffffc3ffffffa5ffffff78ffffff4cffffff23ffffff78ffffff4cffffff23ffff", "ffe4ffffffc3ffffffa5ffffff78ffffff4cffffff23ffffff00ffffff00ffffff00ffffffe4ffffffc3ffffffa5ffffff78ffffff4cffffff23ffff"] },
    { name: "multiply after smush", first: [], second: ["-channel", "R"], edit: ["-evaluate", "Multiply", "0.5"],
        expected: ["060e14ff1a1e24ff292d32ff060e14ff1a1e24ff292d32ff3a4449ff505a5fff656e78ff3a4449ff505a5fff656e78ff", "060e14ff1a1e24ff292d32ff3a4449ff505a5fff656e78ff808080ff808080ff808080ff060e14ff1a1e24ff292d32ff3a4449ff505a5fff656e78ff"] },
    { name: "unchanged smush pixels", first: [], second: ["-channel", "R"], edit: [],
        expected: ["0c1b28ff333c47ff515a64ff0c1b28ff333c47ff515a64ff738791ffa0b3beffc9dcefff738791ffa0b3beffc9dcefff", "0c1b28ff333c47ff515a64ff738791ffa0b3beffc9dcefffffffffffffffffffffffffff0c1b28ff333c47ff515a64ff738791ffa0b3beffc9dcefff"] },
    { name: "reset after smush", first: [], second: ["-channel", "R"], edit: ["+channel", "-negate"],
        expected: ["f3e4d7ffccc3b8ffaea59bfff3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff8c786eff5f4c41ff362310ff", "f3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff000000ff000000ff000000fff3e4d7ffccc3b8ffaea59bff8c786eff5f4c41ff362310ff"] },
    { name: "selection after smush", first: [], second: ["-channel", "R"], edit: ["-channel", "B", "-negate"],
        expected: ["0c1bd7ff333cb8ff515a9bff0c1bd7ff333cb8ff515a9bff73876effa0b341ffc9dc10ff73876effa0b341ffc9dc10ff", "0c1bd7ff333cb8ff515a9bff73876effa0b341ffc9dc10ffffff00ffffff00ffffff00ff0c1bd7ff333cb8ff515a9bff73876effa0b341ffc9dc10ff"] },
])(`${mode} ${direction}: $name`, async ({ first, second, edit, expected }) => {
    const argv = ["(", "in.ppm", ...first, ")", "(", "in.ppm", ...second, ")",
        direction!, String(index), ...edit, "-depth", "8", "rgba:-"];
    const files = new Map([["in.ppm", ppm]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", ppm);
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected[index]);
});
