import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const identity = "0,0,0,0,1,0,0,0,0";
// ImageMagick 7.1.2-35 Q16-HDRI, complete raw output bytes.
const cases = [
    { name: "define", options: ["-define", "convolve:bias=10%"], expected: "3a5a7a" },
    { name: "bias", options: ["-bias", "10%"], expected: "3a5a7a" },
    { name: "later reset", options: ["-bias", "10%"], after: ["+bias", "-convolve", identity], expected: "3a5a7a" },
    { name: "before input", before: true, options: ["-bias", "10%"], expected: "3a5a7a" },
    { name: "quantum units", options: ["-bias", "6553.5"], expected: "3a5a7a" },
    { name: "negative bias", options: ["-bias", "-10%"], expected: "062646" },
    { name: "zero define", options: ["-define", "convolve:bias=0%"], expected: "204060" },
    { name: "zero bias", options: ["-bias", "0%"], expected: "204060" },
    { name: "unset", options: [], expected: "204060" },
    { name: "reset bias", options: ["-define", "convolve:bias=10%", "+bias"], expected: "204060" },
    { name: "reset define", options: ["-bias", "10%", "+define", "convolve:bias"], expected: "204060" },
    { name: "define overrides bias", options: ["-bias", "10%", "-define", "convolve:bias=20%"], expected: "537393" },
    { name: "bias overrides define", options: ["-define", "convolve:bias=20%", "-bias", "10%"], expected: "3a5a7a" },
    { name: "red channel", options: ["-bias", "10%", "-channel", "R"], expected: "3a4060" },
    { name: "transparent color", color: "#20406080", options: ["-bias", "10%"], format: "rgba", expected: "5373939a" },
    { name: "alpha channel", color: "#20406080", options: ["-bias", "10%", "-channel", "A"], format: "rgba", expected: "2040609a" },
    { name: "16-bit output", options: ["-bias", "10%"], depth: "16", expected: "39ba59da79fa" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each(cases)(`applies convolution bias (${mode}, $name)`, async ({ options, color, format, depth, after, before, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = [...(before ? options : []), `xc:${color ?? "#204060"}`, ...(before ? [] : options), "-convolve", identity,
        ...(after ?? []), "+channel", "-depth", depth ?? "8", "-endian", "MSB", `${format ?? "rgb"}:-`];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});

for (const reset of [false, true])
it(`supports convolution bias in mogrify (reset=${reset})`, () => {
    const input = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([32, 64, 96])]);
    const files = new Map([["/in.ppm", input]]);
    const result = runMagickCliSync(["mogrify", "-bias", "10%", ...(reset ? ["+bias"] : []), "-convolve", identity, "/in.ppm"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(runMagickCliSync(["/in.ppm", "-depth", "8", "rgb:-"], files).stdoutBytes!).toString("hex")).toBe(reset ? "204060" : "3a5a7a");
});

it.each(["garbage", "10garbage"])("rejects invalid bias %s without replacing output", value => {
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([["/out.png", original]]);
    const result = runMagickCliSync(["xc:#204060", "-bias", value, "-convolve", identity, "/out.png"], files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-bias'");
    expect(files.get("/out.png")).toEqual(original);
});
