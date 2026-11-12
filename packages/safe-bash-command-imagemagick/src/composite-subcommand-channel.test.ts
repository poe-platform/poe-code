import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// Complete RGBA8 outputs from ImageMagick 7.1.2-35 Q16-HDRI.
for (const route of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { args: ["-channel", "R", "in.ppm", "base.ppm"], hex: "0a6e3cff5a6e3cffa06e3cffa06e3cffa06e3cff" },
    { args: ["-tile", "-channel", "R", "in.ppm", "base.ppm"], hex: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
    { args: ["-tile", "in.ppm", "-channel", "R", "base.ppm"], hex: "0a6e3cff5a6e3cff0a6e3cff5a6e3cff0a6e3cff" },
    { args: ["-tile", "in.ppm", "-channel", "R", "+channel", "base.ppm"], hex: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
    { args: ["+channel", "in.ppm", "base.ppm"], hex: "0a141eff5a6e82ffa06e3cffa06e3cffa06e3cff" },
    { args: ["-compose", "CopyRed", "in.ppm", "base.ppm"], hex: "0a6e3cff5a6e3cffa06e3cffa06e3cffa06e3cff" },
    { args: ["-tile", "in.ppm", "base.ppm"], hex: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
])(`${route}: $args`, async ({ args, hex }) => {
    const files = new Map([
        ["in.ppm", Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])])],
        ["base.ppm", Buffer.concat([Buffer.from("P6\n5 1\n255\n"), Buffer.from(Array(5).fill([160, 110, 60]).flat())])],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    const argv = [...args, "-depth", "8", "rgba:-"];
    let stdout = "", stderr = "", exitCode: number;
    if (route === "command") {
        const argumentValues = createCommandArguments(["composite", ...argv]);
        ({ exitCode } = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }));
    } else {
        const result = route === "sync" ? runCompositeCliSync(argv, files)
            : await runCompositeCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        ({ exitCode, stderr } = result);
        stdout = Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout)).toString("hex");
    }
    expect(exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(hex);
});
