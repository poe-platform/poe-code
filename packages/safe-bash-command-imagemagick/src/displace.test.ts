import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI RGB references. White is just below +1 at Q16 precision.
const cases = [
    { map: "white", scale: "1", hex: "0002fffd000000000002fffd00000000ffff" },
    { map: "black", scale: "1", hex: "ffff00000000ffff000000000000ffff0000" },
    { map: "white", scale: "-1", hex: "ffff00000000fffd000200000000fffd0002" },
    { map: "white", scale: "0", hex: "ffff000000000000ffff000000000000ffff" },
    { map: "black", scale: "0", hex: "ffff000000000000ffff000000000000ffff" },
    { map: "white", scale: "0.5", hex: "80017fff0000000080017fff00000000ffff" }
];

for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const vertical of [false, true])
for (const depth of [8, 16])
it.each(cases)(`${route}: Displace $map map by $scale, vertical=${vertical}, depth=${depth}`, async ({ map, scale, hex }) => {
    const argv = ["xc:red", "xc:lime", "xc:blue", vertical ? "-append" : "+append",
        "-size", vertical ? "1x3" : "3x1", `xc:${map}`, "-compose", "Displace",
        "-define", `compose:args=${vertical ? `0x${scale}` : `${scale}x0`}`, "-composite",
        "-depth", String(depth), "-endian", "MSB", "rgb:-"];
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
    const reference = Buffer.from(hex, "hex");
    const expected = depth === 16 ? reference : Uint8Array.from({ length: reference.length / 2 }, (_, channel) =>
        Math.round(reference.readUInt16BE(channel * 2) / 257));
    expect(Buffer.from(bytes)).toEqual(Buffer.from(expected));
});

for (const retained of [false, true])
it.each(["white", "black"])(`Displace reads the original pixels across storage spans, retained=${retained}, map=%s`, async map => {
    const result = await runMagickCli(["-size", "512x1", "xc:red", "-size", "1x1", "xc:blue", "+append",
        "-size", "513x1", `xc:${map}`, "-compose", "Displace", "-define", "compose:args=1x0",
        "-composite", "-depth", "8", "rgb:-"], retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const expected = Buffer.from(Array.from({ length: 513 }, (_, pixel) =>
        map === "white" && pixel >= 511 ? [0, 0, 255] : [255, 0, 0]).flat());
    expect(Buffer.from(result.stdoutBytes!)).toEqual(expected);
});
