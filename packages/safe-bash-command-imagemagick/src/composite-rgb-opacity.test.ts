import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 references from ImageMagick 7.1.2-35 Q16-HDRI.
for (const route of ["command", "retained", "buffered", "sync"] as const) {
    for (const { compose, opaque, active } of [
        { compose: "Bumpmap", opaque: ["0c0804ff", "432e19ff"], active: "0c080413432e196b" },
        { compose: "ModulusSubtract", opaque: ["69a5e1ff", "b90046ff"], active: "69a5e100b9004600" },
    ]) {
        it.each([
            { args: ["composite", "-compose", compose, "in.ppm", "base.ppm"], hex: opaque.join("") + "a06e3cff".repeat(3) },
            { args: ["composite", "-tile", "-compose", compose, "in.ppm", "base.ppm"], hex: opaque.join("").repeat(2) + opaque[0] },
            { args: ["base.ppm", "in.ppm", "-compose", compose, "-composite"], hex: opaque.join("") + "a06e3cff".repeat(3) },
            { args: ["base.ppm", "in.ppm", "-alpha", "set", "-compose", compose, "-composite"], hex: active + "a06e3cff".repeat(3) },
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
                const argumentValues = createCommandArguments(argv);
                ({ exitCode } = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }));
            } else {
                const result = route === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
                ({ exitCode, stderr } = result);
                stdout = Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout)).toString("hex");
            }
            expect(exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            expect(stdout).toBe(hex);
        });
    }
}
