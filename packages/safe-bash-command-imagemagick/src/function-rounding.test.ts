import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI results; unselected green, blue, and alpha stay intact.
describe.each(["command", "retained", "buffered", "sync"] as const)("Polynomial half-step rounding (%s)", mode => {
    it.each([
        { color: "345caa80", coefficients: "0.5,-0.1", red8: "01", red16: "0081" },
        { color: "365caa80", coefficients: "0.5,-0.1", red8: "02", red16: "0182" },
        { color: "345caa80", coefficients: "0.5 -0.1", red8: "01", red16: "0081" },
        { color: "365caa80", coefficients: "0.5 -0.1", red8: "02", red16: "0182" },
        { color: "345caa80", coefficients: "0.5-0.1", red8: "01", red16: "0081" },
        { color: "365caa80", coefficients: "0.5-0.1", red8: "02", red16: "0182" },
        { color: "345caa80", coefficients: "0.5,-0.09999", red8: "01", red16: "0081" },
        { color: "345caa80", coefficients: "0.5,-0.10001", red8: "00", red16: "0080" },
        { color: "345caa80", coefficients: "0.5,-0.1", multiply: true, red8: "40", red16: "4040" },
    ])("rounds $color with $coefficients (multiply=$multiply)", async ({ color, coefficients, multiply, red8, red16 }) => {
        for (const depth of [8, 16]) {
            const argv = [`xc:#${color}`, "-channel", "R", "-function", "Polynomial", coefficients,
                ...(multiply ? ["-evaluate", "Multiply", "128"] : []),
                "+channel", "-depth", String(depth), "-endian", "MSB", "rgba:-"];
            const fs = new MemoryFileSystem();
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            const error = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
            expect(result.exitCode, error).toBe(0);
            expect(error).toBe("");
            const bytes = mode === "command" ? Buffer.concat(chunks)
                : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
                : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
            expect.soft(bytes.toString("hex"), `depth ${depth}`).toBe(depth === 8 ? `${red8}5caa80` : `${red16}5c5caaaa8080`);
        }
    });
});
