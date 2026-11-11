import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA16 samples from ImageMagick 7.1.2-35 Q16-HDRI.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]])
for (const depth of [8, 16])
it.each([
    { name: "alpha", input: ["xc:#d8412580", "-channel", "A"], expected: "3131a5a59b9bb080" },
    { name: "red", input: ["xc:#d8412580", "-channel", "R"], expected: "ab40a5a59b9b6060" },
    { name: "green and blue", input: ["xc:#d8412580", "-channel", "GB"], expected: "31315c8e455c6060" },
    { name: "unselected", input: ["xc:#d8412580"], expected: "ab405c8e455cb080" },
    { name: "reset", input: ["xc:#d8412580", "-channel", "R", "+channel"], expected: "ab405c8e455cb080" },
    { name: "default mask", input: ["xc:#d8412580", "-channel", "Default"], expected: "ab405c8e455cb080" },
    { name: "first frame mask", input: ["(", "xc:#d8412580", "-channel", "R", ")", "xc:#268ce4a0"], expected: "3e77a5a59b9b6060" },
    { name: "second frame mask", input: ["xc:#d8412580", "(", "xc:#268ce4a0", "-channel", "R", ")"], expected: "4ccf7e9bb68ee261" },
    { name: "retained mask", input: ["xc:#d8412580", "-channel", "R", ...operation, "xc:#268ce4a0"], expected: "35e7a5a59b9b6060" },
    ...[
        { compose: "Over", channel: "A", expected: "3131a5a59b9bb0803131a5a59b9bc488" },
        { compose: "Over", channel: "R", expected: "ab40a5a59b9b6060282aa5a59b9b6060" },
        { compose: "Multiply", channel: "A", expected: "3131a5a59b9bb0803131a5a59b9bc488" },
        { compose: "Multiply", channel: "R", expected: "7b3da5a59b9b60601eafa5a59b9b6060" },
        { compose: "Copy", channel: "A", expected: "3131a5a59b9b80803131a5a59b9ba0a0" },
        { compose: "Copy", channel: "R", expected: "d8d8a5a59b9b60602626a5a59b9b6060" },
    ].map(({ compose, channel, expected }) => ({
        name: `offset ${compose} ${channel}`,
        input: ["xc:#d8412580", "-repage", "3x1+0+0", "(", "xc:#268ce4a0", "-repage", "3x1+1+0", ")",
            "-channel", channel, "-compose", compose],
        expected: expected + (operation.includes("merge") ? "" : "3131a5a59b9b6060"),
    })),
])(`${route}: ${operation.join(" ")} ${depth}-bit $name`, async ({ input, expected }) => {
    const argv = ["-background", "#31a59b60", ...input, ...operation, "-depth", String(depth), "-endian", "MSB", "rgba:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    const reference = Buffer.from(expected, "hex");
    expect(Buffer.from(bytes)).toEqual(depth === 16 ? reference : Buffer.from(
        Array.from({ length: reference.length / 2 }, (_, index) => Math.round(reference.readUInt16BE(index * 2) / 257))));
});
