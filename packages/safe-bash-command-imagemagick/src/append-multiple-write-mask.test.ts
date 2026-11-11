import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from([12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239]),
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output. With no source alpha,
// the fourth exported slot depends on the write mask, not just the RGB samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+append", "-append"])
for (const mask of ["write-mask", "region", "none"])
it.each([
    { name: "raw", after: [], rows: [["0c1b28", "333c47", "515a64"], ["738791", "a0b3be", "c9dcef"]], cleared: false },
    { name: "negated", after: ["-negate"], rows: [["f3e4d7", "ccc3b8", "aea59b"], ["8c786e", "5f4c41", "362310"]], cleared: false },
    { name: "cleared then negated", after: ["+write-mask", "-negate"], rows: [["f3e4d7", "ccc3b8", "aea59b"], ["8c786e", "5f4c41", "362310"]], cleared: true },
])(`${mode} ${direction} first ${mask}: $name`, async ({ after, rows, cleared }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const options = mask === "write-mask" ? ["-write-mask", "/in.ppm"] : mask === "region" ? ["-region", "1x1+0+1"] : [];
    const argv = ["(", "/in.ppm", ...options, ")", "/in.ppm", direction, ...after, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    const pixels = direction === "+append" ? rows.flatMap(row => [...row, ...row]) : [...rows, ...rows].flat();
    const fourth = mask === "none" || cleared ? "ff" : "00";
    expect(Buffer.from(bytes).toString("hex")).toBe(pixels.map(rgb => rgb + fourth).join(""));
});
