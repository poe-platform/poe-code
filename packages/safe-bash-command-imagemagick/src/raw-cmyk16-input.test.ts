import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, bytes 1 through 48.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { coder: "cmyka", endian: "MSB", interlace: "None", output: "rgba", expected: "f7fcf608f414090ae49ee2bee0de1314d209d03dce721d1ec03dbe86bcce2728" },
    { coder: "cmyka", endian: "LSB", interlace: "None", output: "rgba", expected: "f607f415f2230a09e2bde0dfdf011413d03cce72cca91e1dbe84bccfbb192827" },
    { coder: "cmyk", endian: "MSB", interlace: "Plane", output: "rgba", expected: "e5fce231de6ddab2debedb02d74fd3a4d780d3d4d031cc96ffffffffffffffff" },
    { coder: "cmyk", endian: "MSB", interlace: "None", output: "rgba", expected: "f7fcf608f414ffffe86de689e4a6ffffd95fd78cd5b8ffffcad2c90fc74bffff" },
    { coder: "cmyka", endian: "MSB", interlace: "None", output: "cmyka", expected: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728" },
    { coder: "cmyk", endian: "MSB", interlace: "Plane", output: "cmyka", expected: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20ffffffffffffffff" },
    { coder: "cmyk", endian: "MSB", interlace: "None", output: "cmyka", expected: "0102030405060708ffff090a0b0c0d0e0f10ffff1112131415161718ffff191a1b1c1d1e1f20ffff" },
])(`${mode}: $coder $endian $interlace to $output`, async ({ coder, endian, interlace, output, expected }) => {
    const input = Uint8Array.from({ length: 48 }, (_, i) => i + 1);
    const files = new Map<string, Uint8Array>([["/in.raw", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.raw", input);
    const argv = ["-size", "2x2", "-depth", "16", "-endian", endian, "-interlace", interlace,
        `${coder}:/in.raw[0]`, "-depth", "16", "-endian", "MSB", `${output}:-`];
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
