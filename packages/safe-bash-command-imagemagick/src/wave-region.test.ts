import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including the region-clearing and zero-amplitude controls.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { name: "retains the warped selection on export", wave: "1x4", after: [], hex: "ffffff00ffffff00ffffff00587da2ff0b3055ffffffff00e90e33ff14395effc7ec11ff7a9fc4ffa5caef00d0f51aff83a8cdff365b80006186abffffffff00ffffff00f2173cffffffff00ffffff00" },
    { name: "negates the warped selection and padded pixels", wave: "1x4", after: ["-negate", "+region"], hex: "000000ff000000ff000000ff587da2ff0b3055ff000000ffe90e33ff14395effc7ec11ff7a9fc4ff5a3510ffd0f51aff83a8cdffc9a47fff6186abff000000ff000000fff2173cff000000ff000000ff" },
    { name: "clears the warped selection", wave: "1x4", after: ["+region"], hex: "ffffffffffffffffffffffff587da2ff0b3055ffffffffffe90e33ff14395effc7ec11ff7a9fc4ffa5caefffd0f51aff83a8cdff365b80ff6186abfffffffffffffffffff2173cffffffffffffffffff" },
    { name: "negates all pixels after clearing", wave: "1x4", after: ["+region", "-negate"], hex: "000000ff000000ff000000ffa7825dfff4cfaaff000000ff16f1ccffebc6a1ff3813eeff85603bff5a3510ff2f0ae5ff7c5732ffc9a47fff9e7954ff000000ff000000ff0de8c3ff000000ff000000ff" },
    { name: "keeps the selection with zero amplitude", wave: "0x4", after: ["-negate", "+region"], hex: "0b3055ff7a9fc4ffe90e33ff587da2ffc7ec11ffc9a47fff5a3510ff14395eff83a8cdfff2173cff6186abffd0f51aff" },
])(`${mode}: $name`, async ({ wave, after, hex }) => {
    const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from({ length: 36 }, (_, i) => (37 * i + 11) % 256)]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", "-region", "2x1+1+1", "-wave", wave, ...after, "-depth", "8", "rgba:-"];
    const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
