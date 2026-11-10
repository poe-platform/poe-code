import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: separated masked planes export transparent RGBA.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const { height, depth, evaluate } of [{ height: 2, depth: 8, evaluate: false }, { height: 257, depth: 16, evaluate: true }])
for (const channel of ["R", "A"])
for (const mask of ["region", "write-mask", "none"])
for (const format of ["rgba", "rgb", "gray"])
for (const clear of [false, true]) {
    if (clear && (mask === "none" || format !== "rgba")) continue;
    it(`${mode}: separates ${channel} with ${mask} to ${depth}-bit ${format} (${height} rows), evaluate=${evaluate}, clear=${clear}`, async () => {
        const files = new Map([
            ["mask.pgm", Buffer.concat([Buffer.from(`P5\n4 ${height}\n255\n`), Buffer.from("00ff00ffff00ff00".repeat(Math.ceil(height / 2)), "hex").subarray(0, height * 4)])],
            ["out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-size", `4x${height}`, "xc:#80402060", ...(evaluate ? ["-evaluate", "Add", "0"] : []),
            ...(mask === "none" ? [] : [`-${mask}`, mask === "region" ? "1x1+0+0" : "mask.pgm"]),
            "-channel", channel, "-separate", "+channel", ...(clear ? [`+${mask}`] : []), "-depth", String(depth), `${format}:out`];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const gray = (channel === "R" ? "80" : "60").repeat(depth / 8);
        const pixel = gray.repeat(format === "gray" ? 1 : 3) + (format === "rgba" ? (mask === "none" || clear ? "ff" : "00").repeat(depth / 8) : "");
        expect(Buffer.from(output).toString("hex")).toBe(pixel.repeat(4 * height));
    });
}
