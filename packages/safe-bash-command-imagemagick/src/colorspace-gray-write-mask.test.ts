import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: protected pixels retain red as their gray sample.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const repeats of [1, 513])
for (const mask of ["attached", "cleared", "none"] as const)
it.each([
    { space: "Gray", masked: "4d4d4d1c1c1c", unmasked: "4d4d4d505050" },
    { space: "LinearGray", masked: "1717171c1c1c", unmasked: "171717181818" },
])(`${mode}, ${repeats} pairs, ${mask} mask: converts to $space`, async ({ space, masked, unmasked }) => {
    const files = new Map<string, Uint8Array>([
        ["in.ppm", Buffer.concat([Buffer.from(`P6\n${repeats * 2} 1\n255\n`), Buffer.from("1956931c5996".repeat(repeats), "hex")])],
        ["mask.pgm", Buffer.concat([Buffer.from(`P5\n${repeats * 2} 1\n255\n`), Buffer.from("00ff".repeat(repeats), "hex")])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const argv = ["in.ppm", ...(mask === "none" ? [] : ["-write-mask", "mask.pgm"]),
        "-colorspace", space, ...(mask === "cleared" ? ["+write-mask"] : []), "-depth", "8", "rgb:out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe((mask === "none" ? unmasked : masked).repeat(repeats));
});
