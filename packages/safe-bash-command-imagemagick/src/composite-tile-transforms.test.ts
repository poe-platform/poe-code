import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// Complete RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const unchanged = "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff";
for (const route of ["command", "buffered", "retained", "sync"] as const)
for (const transform of [
    { args: ["-resize", "1x1!"], tiled: "324150ff", plain: "324150ff" },
    { args: ["-rotate", "180"], tiled: "5a6e82ff0a141eff5a6e82ff0a141eff5a6e82ff", plain: "5a6e82ff0a141effa06e3cffa06e3cffa06e3cff" },
    { args: ["-negate"], tiled: "f5ebe1ffa5917dfff5ebe1ffa5917dfff5ebe1ff", plain: "f5ebe1ffa5917dff5f91c3ff5f91c3ff5f91c3ff" }
])
for (const placement of ["before inputs", "after inputs", "without tile", "before tile", "after intervening setting"] as const)
it(`${route}: composite ${transform.args.join(" ")} ${placement}`, async () => {
    const inputs = ["in.ppm", "base.ppm"];
    const argv = [
        ...(placement === "before tile" ? [...transform.args, "-tile", ...inputs]
            : [
                ...(placement === "without tile" ? [] : ["-tile"]),
                ...(placement === "after intervening setting" ? ["-depth", "8"] : []),
                ...(placement === "after inputs" ? [...inputs, ...transform.args] : [...transform.args, ...inputs])
            ]),
        "-depth", "8", "rgba:-"
    ];
    const files = new Map([
        ["in.ppm", Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])])],
        ["base.ppm", Buffer.concat([Buffer.from("P6\n5 1\n255\n"), Buffer.from(Array.from({ length: 5 }, () => [160, 110, 60]).flat())])]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    let output: Uint8Array | undefined;
    if (route === "command") {
        const args = createCommandArguments(["composite", ...argv]);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = Buffer.concat(chunks);
    } else {
        const result = route === "sync" ? runCompositeCliSync(argv, files)
            : await runCompositeCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = result.stdoutBytes;
    }
    expect(Buffer.from(output ?? []).toString("hex")).toBe(
        placement === "before inputs" ? unchanged : placement === "without tile" ? transform.plain : transform.tiled
    );
});
