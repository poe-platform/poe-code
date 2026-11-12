import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
    ["push gradient fade linear 0,0 5,0 stop-color red 0% stop-color blue 100% pop gradient fill fade", "802fce8898bbc7a6639cb54399e2ad210184270add9f6d4acfaabb5d9f93cfb6"],
    ["push defs push gradient fade linear 0,0 5,0 stop-color red 0% stop-color blue 100% pop gradient pop defs fill fade", "802fce8898bbc7a6639cb54399e2ad210184270add9f6d4acfaabb5d9f93cfb6"],
    ["push gradient fade linear 0,0 0,2 stop-color red 0% stop-color blue 100% pop gradient fill fade", "f2866b4d79094c43d050c39ea83fd9c65f14b9cf73a01c7cdcb3b0264b7058d5"],
    ["push gradient fade linear 0,0 5,0 stop-color red 0% stop-color lime 40% stop-color blue 100% pop gradient fill fade", "454df4e1dedb1802f17d00b7d97f216235d21efed14693585c4a71471707d132"],
    ["push gradient fade radial 0,0 5,2 4 stop-color red 0% stop-color blue 100% pop gradient fill fade", "6b5e44499fb16e446aba0f0dbb4bc295feb5e27950df751f76db648457573ab3"],
    ["push gradient fade linear 0,0 5,0 stop-color red 0 stop-color blue 1 pop gradient fill fade push graphic-context fill lime pop graphic-context", "802fce8898bbc7a6639cb54399e2ad210184270add9f6d4acfaabb5d9f93cfb6"],
    ["push gradient fade linear 0,0 5,0 stop-color red 0 stop-color blue 1 pop gradient fill fade fill red", "604af6413b368fb247fa6ce2f321f7ef960801dcca560e2def01bd5f72f17973"],
    ["fill red", "604af6413b368fb247fa6ce2f321f7ef960801dcca560e2def01bd5f72f17973"],
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: renders %s`, async (drawing, hash) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argv = ["-size", "6x3", "xc:white", "-draw", `${drawing} rectangle 0,0 5,2`, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:out.rgb"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, JSON.stringify(result) + stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out.rgb") : files.get("out.rgb")!;
        expect(output.length).toBe(54);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
