import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI fifth-channel outputs.
const cases = [
    { operations: [], hex: "4080c0" },
    { operations: ["-roll", "+1+0"], hex: "c04080" },
    ...[[], ["-channel", "Meta0"], ["-channel", "R"]].flatMap(channels => [
        { operations: [...channels, "-write-mask", "/mask.pgm", "-roll", "+1+0", "+write-mask"], hex: channels[1] === "R" ? "c04080" : "4040c0" },
        { operations: [...channels, "-region", "1x1+1+0", "-roll", "+1+0", "+region"], hex: channels[1] === "R" ? "c04080" : "4040c0" },
    ]),
];

for (const mode of ["command", "buffered", "sync", "retained"])
    it.each(cases)(`${mode}: $operations`, async ({ operations, hex }) => {
        const input = Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([255, 0, 255])]);
        const files = new Map([["/mask.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/mask.pgm", input);
        const argv = ["-size", "3x1", "xc:white", "-duplicate", "3", "(", "-size", "1x1",
            "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
            ...operations, "-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
