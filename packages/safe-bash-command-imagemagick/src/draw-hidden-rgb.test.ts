import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact geometry and RGBA bytes captured from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    {
        "name": "rectangle",
        "args": [
            "-size",
            "4x1",
            "xc:#11223300",
            "-fill",
            "red",
            "-draw",
            "rectangle 1,0 2,0"
        ],
        "rgba": "00000000ff0000ffff0000ff00000000",
        "off": "000000ffff0000ffff0000ff000000ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "line",
        "args": [
            "-size",
            "4x1",
            "xc:#11223300",
            "-stroke",
            "red",
            "-draw",
            "line 1,0 2,0"
        ],
        "rgba": "00000000ff0000ffff0000ffff000010",
        "off": "000000ffff0000ffff0000ffff0000ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "no drawing",
        "args": [
            "-size",
            "4x1",
            "xc:#11223300"
        ],
        "rgba": "11223300112233001122330011223300",
        "off": "112233ff112233ff112233ff112233ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "point",
        "args": [
            "-size",
            "4x1",
            "xc:#11223300",
            "-fill",
            "red",
            "-draw",
            "point 1,0"
        ],
        "rgba": "11223300ff0000ff1122330011223300",
        "off": "112233ffff0000ff112233ff112233ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "opaque rectangle",
        "args": [
            "-size",
            "4x1",
            "xc:#112233ff",
            "-fill",
            "red",
            "-draw",
            "rectangle 1,0 2,0"
        ],
        "rgba": "112233ffff0000ffff0000ff112233ff",
        "off": "112233ffff0000ffff0000ff112233ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "translucent rectangle",
        "args": [
            "-size",
            "4x1",
            "xc:#11223380",
            "-fill",
            "red",
            "-draw",
            "rectangle 1,0 2,0"
        ],
        "rgba": "11223380ff0000ffff0000ff11223380",
        "off": "112233ffff0000ffff0000ff112233ff",
        "geometry": "4x1 4x1+0+0"
    },
    {
        "name": "bounded rectangle",
        "args": [
            "-size",
            "8x7",
            "xc:#11223300",
            "-fill",
            "red",
            "-draw",
            "rectangle 3,3 4,3"
        ],
        "rgba": "112233001122330011223300112233001122330011223300112233001122330011223300000000000000000000000000000000000000000000000000112233001122330000000000000000000000000000000000000000000000000011223300112233000000000000000000ff0000ffff0000ff000000000000000011223300112233000000000000000000000000000000000000000000000000001122330011223300000000000000000000000000000000000000000000000000112233001122330011223300112233001122330011223300112233001122330011223300",
        "off": "112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ffff0000ffff0000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff",
        "geometry": "8x7 8x7+0+0"
    },
    {
        "name": "bounded line",
        "args": [
            "-size",
            "8x7",
            "xc:#11223300",
            "-stroke",
            "red",
            "-draw",
            "line 3,3 4,3"
        ],
        "rgba": "112233001122330011223300112233001122330011223300112233001122330011223300000000000000000000000000000000000000000000000000112233001122330000000000000000000000000000000000000000000000000011223300112233000000000000000000ff0000ffff0000ffff0000100000000011223300112233000000000000000000ff000010ff00001000000000000000001122330011223300000000000000000000000000000000000000000000000000112233001122330011223300112233001122330011223300112233001122330011223300",
        "off": "112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ffff0000ffff0000ffff0000ff000000ff112233ff112233ff000000ff000000ffff0000ffff0000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff",
        "geometry": "8x7 8x7+0+0"
    },
    {
        "name": "zero stroke width",
        "args": [
            "-size",
            "8x7",
            "xc:#11223300",
            "-fill",
            "red",
            "-strokewidth",
            "0",
            "-draw",
            "rectangle 3,3 4,3"
        ],
        "rgba": "112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300000000000000000000000000000000001122330011223300112233001122330000000000ff0000ffff0000ff000000001122330011223300112233001122330000000000000000000000000000000000112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300",
        "off": "112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff112233ff000000ffff0000ffff0000ff000000ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff",
        "geometry": "8x7 8x7+0+0"
    },
    {
        "name": "fractional bounds",
        "args": [
            "-size",
            "8x7",
            "xc:#11223300",
            "-fill",
            "red",
            "-draw",
            "rectangle 3.2,3.2 4.2,4.2"
        ],
        "rgba": "112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300112233001122330011223300000000000000000000000000000000000000000011223300112233001122330000000000ff000083ff0000a3ff0000080000000011223300112233001122330000000000ff0000a3ff0000ffff00000a0000000011223300112233001122330000000000ff000008ff00000a0000000000000000112233001122330011223300000000000000000000000000000000000000000011223300",
        "off": "112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff000000ffff0000ffff0000ffff0000ff000000ff112233ff112233ff112233ff000000ffff0000ffff0000ffff0000ff000000ff112233ff112233ff112233ff000000ffff0000ffff0000ff000000ff000000ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff112233ff",
        "geometry": "8x7 8x7+0+0"
    },
    {
        "name": "stroke only rectangle",
        "args": [
            "-size",
            "8x7",
            "xc:#11223300",
            "-fill",
            "none",
            "-stroke",
            "red",
            "-draw",
            "rectangle 3,3 4,3"
        ],
        "rgba": "112233001122330011223300112233001122330011223300112233001122330011223300000000000000000000000000000000000000000000000000112233001122330000000000000000000000000000000000000000000000000011223300112233000000000000000000ff0000ffff0000ffff0000100000000011223300112233000000000000000000ff000010ff00001000000000000000001122330011223300000000000000000000000000000000000000000000000000112233001122330011223300112233001122330011223300112233001122330011223300",
        "off": "112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff000000ff000000ffff0000ffff0000ffff0000ff000000ff112233ff112233ff000000ff000000ffff0000ffff0000ff000000ff000000ff112233ff112233ff000000ff000000ff000000ff000000ff000000ff000000ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff112233ff",
        "geometry": "8x7 8x7+0+0"
    }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alphaOff of [false, true])
it.each(cases)(`${mode} alphaOff=${alphaOff}: $name`, async ({ args, rgba, off, geometry }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [...args, ...(alphaOff ? ["-alpha", "off"] : []), "-depth", "8", "-write", "rgba:out", "-format", "%wx%h %g", "info:"];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe(geometry);
    const bytes = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
    expect(Buffer.from(bytes).toString("hex")).toBe(alphaOff ? off : rgba);
});
