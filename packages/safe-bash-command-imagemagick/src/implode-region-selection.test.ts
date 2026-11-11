import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => [
    i * 17, (i * 47) % 256, 200 - i * 7
]).flat())]);

// Complete RGB8 stdout from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    {
        name: "negates the displaced implode region",
        operations: ["-implode", "3", "-negate", "+region"],
        expected: "0000c8112fc1225eba338db344bcac55eba56183960000c888789099a789aad682928880aad682dd636dee9266",
    },
    {
        name: "clears the displaced implode region",
        operations: ["-implode", "3", "+region"],
        expected: "0000c8112fc1225eba338db344bcac55eba54787ab0000c888789099a789aad682af9680aad682dd636dee9266",
    },
    {
        name: "preserves the region at zero implode strength",
        operations: ["-implode", "0", "-negate", "+region"],
        expected: "0000c8112fc1225eba338db344bcac55eba599e56188b66888789099a789aad68244fa8433cb8bdd636dee9266",
    },
    {
        name: "negates the displaced swirl region",
        operations: ["-swirl", "65", "-negate", "+region"],
        expected: "0000c8112fc1225eba338db344bcac55eba599cc6581847c88789099a789aad68256d58046d68395797bee9266",
    },
])(`${mode}: $name`, async ({ operations, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = createCommandArguments(["-limit", "thread", "1", "-seed", "42", "in.ppm", "-region", "2x2+1+1", ...operations, "-depth", "8", "rgb:-"]);
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
