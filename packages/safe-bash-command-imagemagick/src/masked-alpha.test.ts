import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./masked-alpha-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI; PNG32/PNG64 outputs independently decoded to RGBA.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(fixtures.cases)(`${mode}: $name`, async ({ input, args, depth, rgba }) => {
    const files = new Map(Object.entries(fixtures.inputs).map(([name, bytes]) => [`/${name}.png`, Buffer.from(bytes, "base64")]));
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const argv = [`/${input}.png`, ...args, `${depth === 16 ? "PNG64" : "PNG32"}:/out.png`];
    const commandArgs = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: commandArgs.args, argumentValues: commandArgs,
        fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe(args.includes("-contrast")
        ? `magick: option has been replaced '-contrast', use "-level" at CLI arg ${argv.indexOf("-contrast") + 1}\n` : "");
    const output = decodeImage(mode === "command" || mode === "retained"
        ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(rgba);
});
