import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: extracted gray output reads the red sample
// even where the region or write mask protects the original RGB channels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operators: ["-region", "1x1+0+0"], coder: "gray", hex: "ff80808080808080" },
        { operators: ["-write-mask", "mask.pgm"], coder: "gray", hex: "ff80ff8080ff80ff" },
        { operators: ["-region", "1x1+0+0"], coder: "rgb", hex: "ffffff804020804020804020804020804020804020804020" },
        { operators: ["-write-mask", "mask.pgm"], coder: "rgba", hex: "ffffff00804020ffffffff00804020ff804020ffffffff00804020ffffffff00" },
        { operators: [], coder: "gray", hex: "ffffffffffffffff" },
        { operators: ["-region", "1x1+0+0"], coder: "gray", depth: 16, hex: "ffff8080808080808080808080808080" },
        { operators: ["-write-mask", "mask.pgm"], coder: "gray", depth: 16, hex: "ffff8080ffff80808080ffff8080ffff" },
    ])(`${mode}: extracts alpha with $operators to $coder at $depth bits`, async ({ operators, coder, depth = 8, hex }) => {
        const files = new Map([
            ["out", Buffer.from("KEEP")],
            ["mask.pgm", Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 0, 255, 255, 0, 255, 0])])]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-size", "4x2", "xc:#804020ff", ...operators, "-alpha", "extract", "-depth", String(depth), "-endian", "MSB", `${coder}:out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
