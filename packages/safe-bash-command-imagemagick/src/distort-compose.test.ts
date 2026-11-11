import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, inline RGB strips and absolute coordinate maps.
for (const route of ["command", "sync", "buffered", "retained"] as const)
for (const vertical of [false, true])
for (const depth of [8, 16])
it.each([
    { color: "white", args: vertical ? "0x1" : "1x0", pixel: "0000ff", pixel16: "00000002fffd" },
    { color: "black", args: vertical ? "0x1" : "1x0", pixel: "ff0000", pixel16: "ffff00000000" },
    { color: "white", args: "0x0", pixel: "00ff00", pixel16: "0000ffff0000" },
    { color: "white", args: undefined, pixel: "0000ff", pixel16: "00000002fffd" },
    { color: "white", args: vertical ? "0x0.5" : "0.5x0", pixel: "00807f", pixel16: "000080017fff" },
    { color: "white", args: "0x0+0+0", pixel: "ff0000", pixel16: "ffff00000000" },
    { color: "white", args: vertical ? "0x100%" : "100x0%", pixel: "0000ff", pixel16: "00000002fffd" },
    { color: vertical ? "lime" : "red", args: vertical ? "0x1" : "1x0", pixel: "0000ff", pixel16: "00000002fffd" },
    { color: vertical ? "red" : "lime", args: vertical ? "0x1" : "1x0", pixel: "ff0000", pixel16: "ffff00000000" },
])(`${route} RGB${depth} Distort vertical=${vertical} $color $args samples destination coordinates`, async ({ color, args, pixel, pixel16 }) => {
    const argv = ["xc:red", "xc:lime", "xc:blue", vertical ? "-append" : "+append",
        "-size", vertical ? "1x3" : "3x1", `xc:${color}`, "-compose", "Distort",
        ...(args === undefined ? [] : ["-define", `compose:args=${args}`]), "-composite", "-depth", String(depth), "-endian", "MSB", "rgb:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
        .toEqual({ exitCode: 0, stderr: "" });
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe((depth === 16 ? pixel16 : pixel).repeat(3));
});

for (const retained of [false, true])
it.each([
    { alpha: false, map: "#ffffff80", pixel: "000080017fffffff" },
    { alpha: true, map: "#ffffff80", pixel: "000080017fff8080" },
    { alpha: false, map: "none", pixel: "800080000000ffff" },
    { alpha: true, map: "none", pixel: "8000800000000000" },
])(`Distort retained=${retained} alpha=$alpha map=$map preserves mapped color and masks active alpha`, async ({ alpha, map, pixel }) => {
    const result = await runMagickCli(["xc:red", "xc:lime", "xc:blue", "+append", ...(alpha ? ["-alpha", "on"] : []),
        "-size", "3x1", `xc:${map}`, "-compose", "Distort", "-define", "compose:args=0.5x0",
        "-composite", "-depth", "16", "-endian", "MSB", "rgba:-"],
    retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(pixel.repeat(3));
});

it.each([false, true])("uses the full image center across bounded spans, retained=%s", async retained => {
    const result = await runMagickCli(["xc:red", "xc:lime", "xc:blue", "+append", "-scale", "600x1!",
        "-size", "600x1", "xc:white", "-compose", "Distort", "-define", "compose:args=0x0", "-composite", "-depth", "8", "rgb:-"],
    retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("00ff00".repeat(600));
});
