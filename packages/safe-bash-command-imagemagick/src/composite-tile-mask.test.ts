import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const route of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { settings: ["-define", "compose:tile=true"], mask: "black", operator: true, expected: "a06e3cffa06e3cffa06e3cffa06e3cffa06e3cff" },
        { settings: ["-tile"], mask: "black", expected: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
        { settings: ["-tile"], mask: "half", expected: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
        { settings: ["-tile"], mask: "stripe", expected: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
        { settings: [], mask: "black", expected: "a06e3cffa06e3cffa06e3cffa06e3cffa06e3cff" },
        { settings: [], mask: "stripe", expected: "a06e3cff5a6e82ffa06e3cffa06e3cffa06e3cff" },
        { settings: ["-tile"], mask: "white", expected: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
        { settings: ["-tile"], mask: "", expected: "0a141eff5a6e82ff0a141eff5a6e82ff0a141eff" },
        { settings: ["-tile", "+tile"], mask: "stripe", expected: "a06e3cff5a6e82ffa06e3cffa06e3cffa06e3cff" },
        { settings: ["-tile"], mask: "missing", expected: "" },
    ])(`${route}: composite $settings with $mask mask`, async ({ settings, mask, operator = false, expected }) => {
        const files = new Map([
            ["/in.ppm", Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])])],
            ["/base.ppm", Buffer.concat([Buffer.from("P6\n5 1\n255\n"), Buffer.from(Array(5).fill([160, 110, 60]).flat())])],
        ]);
        for (const [name, values] of Object.entries({ black: [0, 0], white: [255, 255], half: [128, 128], stripe: [0, 255] })) {
            files.set(`/${name}.pgm`, Buffer.concat([Buffer.from("P5\n2 1\n255\n"), Buffer.from(values)]));
        }
        const fs = createMemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = [...(operator ? ["/base.ppm", "/in.ppm"] : ["composite", ...settings, "/in.ppm", "/base.ppm"]),
            ...(mask ? [`/${mask}.pgm`] : []), ...(operator ? [...settings, "-composite"] : []), "-depth", "8", "rgba:-"];
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : route === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(mask === "missing" ? 1 : 0);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (mask === "missing") expect(diagnostic).toContain("missing.pgm");
        else expect(diagnostic).toBe("");
        const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
