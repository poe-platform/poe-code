import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output, including failure after writing.
for (const route of ["magick", "composite", "retained", "buffered", "sync"] as const)
it.each([
    { name: "isotropic Blur", mode: "Blur", geometry: "1", hex: "131e29ff516477ff", exitCode: 0 },
    { name: "anisotropic Blur", mode: "Blur", geometry: "2x1", hex: "131e29ff495a6cff", exitCode: 0 },
    { name: "rotated Blur", mode: "Blur", geometry: "2x1+45", hex: "131e29ff4c5e71ff", exitCode: 0 },
    { name: "blue-channel rotation range", mode: "Blur", geometry: "2x1+0+90", hex: "131e29ff4c5e71ff", exitCode: 0 },
    { name: "zero-radius minimum sampling", mode: "Blur", geometry: "0", hex: "131e29ff516477ff", exitCode: 0 },
    { name: "missing Blur arguments", mode: "Blur", geometry: undefined, hex: "0a141eff5a6e82ff", exitCode: 1 },
    { name: "empty Blur arguments", mode: "Blur", geometry: "", hex: "0a141eff5a6e82ff", exitCode: 1 },
    { name: "missing horizontal radius", mode: "Blur", geometry: "x1", hex: "0a141eff5a6e82ff", exitCode: 1 },
    { name: "Over control", mode: "Over", geometry: undefined, hex: "0a141eff5a6e82ff", exitCode: 0 }
])(`${route}: $name`, async ({ mode, geometry, hex, exitCode }) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const argv = ["-compose", mode, ...(geometry === undefined ? [] : ["-define", `compose:args=${geometry}`]),
        "/in.ppm", "/in.ppm", "-depth", "8", "rgba:-"];
    const argumentValues = createCommandArguments(route === "magick" ? ["composite", ...argv] : argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const command = route === "magick" || route === "composite";
    const result = command ? await (route === "magick" ? createMagickCommand() : createCompositeCommand()).execute({
        command: route, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runCompositeCliSync(argv, files)
        : await runCompositeCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect.soft(result.exitCode).toBe(exitCode);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect.soft(Buffer.from(output ?? []).toString("hex")).toBe(hex);
    const diagnostic = "stderr" in result ? result.stderr : stderr;
    if (exitCode) expect(diagnostic).toContain(`invalid setting 'compose:args' '${geometry ?? "(null)"}'`);
    else expect(diagnostic).toBe("");
});

for (const route of ["retained", "buffered", "sync"] as const)
it.each([
    { channel: "R", depth: "8", hex: "13141eff496e82ff" },
    { channel: "G", depth: "8", hex: "0a1e1eff5a5a82ff" },
    { channel: "A", depth: "8", hex: "0a141eff5a6e82ff" },
    { channel: "R", depth: "16", hex: "981214141e1effffdb486e6e8282ffff" },
    { channel: "RGBA", depth: "16", hex: "9812b41dcf28ffffdb48bf5aa36cffff" }
])(`${route}: Blur preserves channel selection $channel at depth $depth`, async ({ channel, depth, hex }) => {
    const input = new TextEncoder().encode("P3\n2 1\n255\n10 20 30 90 110 130\n");
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "/in.ppm", "-channel", channel, "-compose", "Blur", "-define", "compose:args=2x1", "-composite", "-depth", depth, "rgba:-"];
    const result = route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stdoutBytes ?? []).toString("hex")).toBe(hex);
});
