import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick Stereo takes source red, destination green/blue, and mean alpha.
const cases = [
    { name: "opaque composite", args: ["xc:#b02050", "xc:#3090c0", "-compose", "Stereo", "-composite"], hex: "303020205050ffff" },
    { name: "opaque flatten", args: ["-background", "#b02050", "xc:#3090c0", "-compose", "Stereo", "-layers", "flatten"], hex: "303020205050ffff" },
    { name: "translucent merge", args: ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482", "-compose", "Stereo", "-layers", "merge"], hex: "49495a5a84847030" },
    { name: "translucent composite", args: ["xc:#395a8433", "xc:#a32c1988", "-compose", "Stereo", "-composite"], hex: "a3a35a5a84845dde" },
    { name: "transparent source", args: ["xc:#395a8433", "xc:#a32c1900", "-compose", "Stereo", "-composite"], hex: "a3a35a5a8484199a" },
    { name: "transparent destination", args: ["xc:#395a8400", "xc:#a32c1988", "-compose", "Stereo", "-composite"], hex: "a3a35a5a84844444" },
    { name: "16-bit input samples", args: ["xc:#123456789abcffff", "xc:#abcd234567895555", "-compose", "Stereo", "-composite"], hex: "abcd56789abcaaaa" },
    { name: "offset preserves uncovered pixels", args: ["-size", "2x1", "xc:#b02050", "-size", "1x1", "xc:#3090c0", "-geometry", "+1+0", "-compose", "Stereo", "-composite"], hex: "b0b020205050ffff303020205050ffff" },
    { name: "Over control", args: ["xc:#b02050", "xc:#3090c0", "-compose", "Over", "-composite"], hex: "30309090c0c0ffff" }
];

for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const depth of [8, 16])
it.each(cases)(`${route}: Stereo $name at ${depth} bits`, async ({ args, hex }) => {
    const argv = [...args, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
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
