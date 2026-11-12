import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: automatic PNG preserves interpolated RGBA16.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const repeats of [1, 300])
for (const { coder, depth, expected, options, identity } of [
    { coder: "png", options: [], identity: false, depth: 16, expected: "5dfe853a7b9d77fc31b192c29041b254" },
    { coder: "PNG64", options: [], identity: false, depth: 16, expected: "5dfe853a7b9d77fc31b192c29041b254" },
    { coder: "PNG32", options: [], identity: false, depth: 8, expected: "5e5e85857b7b7878313192929090b2b2" },
    { coder: "PNG00", options: [], identity: false, depth: 16, expected: "5dfe853a7b9d77fc31b192c29041b254" },
    { coder: "png", options: ["-depth", "8"], identity: false, depth: 8, expected: "5e5e85857b7b7878313192929090b2b2" },
    { coder: "png", options: [], identity: true, depth: 1, expected: "17173e3e5959ffffb5b568682929ffff" },
])
it(`preserves CLUT PNG samples (${mode}, ${coder}, ${options}, identity=${identity}, repeats=${repeats})`, async () => {
    const argv = ["xc:#173e5970", "xc:#b56829cf", "+append", ...(repeats === 1 ? [] : ["-duplicate", String(repeats - 1), "+append"]),
        "(", ...(identity ? ["xc:black", "xc:white"] : ["xc:#7258b433", "xc:#2ba761cf"]), "+append", ")", "-clut", ...options,
        `${coder}:${mode === "command" ? "-" : "/out.png"}`];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(chunks)
        : mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    expect([...output.slice(24, 26)]).toEqual([depth, identity ? 3 : 6]);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([2 * repeats, 1]);
    const samples = image.data16 ?? Uint16Array.from(image.data, value => value * 257);
    const actual = Array.from(samples, value => value.toString(16).padStart(4, "0")).join("");
    expect(actual).toBe(expected.repeat(repeats));
});
