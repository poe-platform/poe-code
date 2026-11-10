import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 5\n255\n"), Buffer.from(Array.from({ length: 25 }, (_, i) => [
    (i * 37 + 19) % 256, (i * 17 + 23) % 256, (i * 59 + 5) % 256
]).flat())]);

// Complete RGBA8 stdout from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    {
        name: "retains swirled selection during alpha export",
        operations: ["-swirl", "120"],
        expected: "131705ff382840ff5d397bff824ab6ffa75bf1ffcc6c2cfff17d6700168ea2003b9fddff60b018ff85c153ffaad28e00f4f404fff4f404ff19053fff3e167aff6327b5ff8838f000ad492bffd25a66fff76ba1ff1c7cdcff418d17ff669e52ff8baf8dff",
    },
    {
        name: "negates the swirled selection",
        operations: ["-swirl", "120", "-negate", "+region"],
        expected: "131705ff382840ff5d397bff824ab6ffa75bf1ffcc6c2cff0e8298ffe9715dff3b9fddff60b018ff85c153ff552d71fff4f404fff4f404ff19053fff3e167aff6327b5ff77c70fffad492bffd25a66fff76ba1ff1c7cdcff418d17ff669e52ff8baf8dff",
    },
    {
        name: "clears the swirled selection",
        operations: ["-swirl", "120", "+region"],
        expected: "131705ff382840ff5d397bff824ab6ffa75bf1ffcc6c2cfff17d67ff168ea2ff3b9fddff60b018ff85c153ffaad28efff4f404fff4f404ff19053fff3e167aff6327b5ff8838f0ffad492bffd25a66fff76ba1ff1c7cdcff418d17ff669e52ff8baf8dff",
    },
    {
        name: "preserves an untransformed region",
        operations: [],
        expected: "131705ff382840ff5d397bff824ab6ffa75bf1ffcc6c2cfff17d6700168ea2003b9fddff60b018ff85c153ffaad28e00cfe3c900f4f404ff19053fff3e167aff6327b5ff8838f0ffad492bffd25a66fff76ba1ff1c7cdcff418d17ff669e52ff8baf8dff",
    },
    {
        name: "preserves implode region coverage",
        operations: ["-implode", "1"],
        expected: "131705ff382840ff5d397bff824ab6ffa75bf1ffcc6c2cfff17d6700168ea2003b9fddff60b018ff85c153ffaad28e00f17d6700f4f404ff19053fff3e167aff6327b5ff8838f0ffad492bffd25a66fff76ba1ff1c7cdcff418d17ff669e52ff8baf8dff",
    },
])(`${mode}: $name`, async ({ operations, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = createCommandArguments(["in.ppm", "-region", "2x2+1+1", "-interpolate", "nearest", ...operations, "-depth", "8", "rgba:-"]);
    const stdout: Buffer[] = [];
    let stderr = "";
    const files = new Map([["in.ppm", input]]);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args.args, files)
        : await runMagickCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
