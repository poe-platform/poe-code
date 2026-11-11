import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const pixels = [12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239];
const ppm = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(pixels)]);

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+append", "-append"])
it.each([
    { name: "second frame selection", first: [], second: ["-channel", "R"], edit: ["-negate"], selected: [0, 1, 2] },
    { name: "first frame selection", first: ["-channel", "R"], second: [], edit: ["-negate"], selected: [0] },
    { name: "different frame selections", first: ["-channel", "G"], second: ["-channel", "R"], edit: ["-negate"], selected: [1] },
    { name: "evaluate with second frame selection", first: [], second: ["-channel", "R"], edit: ["-evaluate", "Multiply", "0"], selected: [0, 1, 2] },
    { name: "evaluate with first frame selection", first: ["-channel", "G"], second: [], edit: ["-evaluate", "Multiply", "0"], selected: [1] },
    { name: "unchanged append pixels", first: [], second: ["-channel", "R"], edit: [], selected: [] },
    { name: "selection after append", first: ["-channel", "R"], second: [], edit: ["-channel", "B", "-negate"], selected: [2] },
    { name: "reset after append", first: ["-channel", "R"], second: [], edit: ["+channel", "-negate"], selected: [0, 1, 2] },
])(`${mode} ${direction}: $name`, async ({ first, second, edit, selected }) => {
    const argv = ["(", "in.ppm", ...first, ")", "(", "in.ppm", ...second, ")", direction, ...edit, "-depth", "8", "rgba:-"];
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
    // Native ImageMagick keeps append's pixels and uses the first frame's selection for negate.
    const indices = direction === "+append" ? [0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5];
    expect([...bytes]).toEqual(indices.flatMap(pixel => [
        ...pixels.slice(pixel * 3, pixel * 3 + 3).map((value, channel) => selected.includes(channel) ? edit.includes("-evaluate") ? 0 : 255 - value : value), 255,
    ]));
});
