import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// The first five cases reproduce the ImageMagick 7.1.2-35 Q16-HDRI comparison.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "same-size extent", geometry: "3x2", expected: "112233445566" },
        { name: "offset crop", geometry: "2x1+1+1", expected: "5566" },
        { name: "no extent", geometry: "", expected: "112233445566" },
        { name: "output dimensions", geometry: "2x1+1+1", expected: "2x1", info: true },
        { name: "ordinary red channel", geometry: "2x1+1+1", expected: "5566", red: true },
        { name: "padding", geometry: "4x3", expected: "112233004455660000000000" },
        { name: "negative offsets", geometry: "4x3-1-1", expected: "000000000011223300445566" },
        { name: "no overlap", geometry: "2x1+8+8", expected: "0000" },
        { name: "selected meta plane", geometry: "2x1+1+1", expected: "5566", before: ["-channel", "10"] },
        { name: "unselected meta plane", geometry: "2x1+1+1", expected: "0000", before: ["-channel", "R"] },
        { name: "copy composition", geometry: "2x1+1+1", expected: "5566", before: ["-compose", "Copy"] },
        { name: "parent arithmetic samples", geometry: "2x1+1+1", expected: "5566", before: ["-evaluate", "Add", "0"] },
        { name: "parent alpha over opaque background", geometry: "3x2", expected: "09111a222b33", alpha: "xc:gray(50%)" },
        { name: "parent alpha over transparent background", geometry: "3x2", expected: "112233445566", alpha: "xc:gray(50%)", before: ["-background", "none"] },
        { name: "16-bit samples", geometry: "2x1+1+1", expected: "55566667", depth: 16 },
    ])(`${mode}: preserves extra channel through $name`, async ({ geometry, expected, ...test }) => {
        const depth = "depth" in test ? test.depth : 8;
        const input = Uint8Array.from([17, 34, 51, 68, 85, 102].flatMap(value => depth === 16
            ? [value, value + 1, value, value + 1, value, value + 1, 255, 255] : [value, value, value, 255]));
        const files = new Map([["in.raw", input], ["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const red = "red" in test && test.red, info = "info" in test && test.info;
        const args = ["-size", "3x2", "-depth", String(depth), "rgba:in.raw",
            ...(red ? [] : ["rgba:in.raw", "rgba:in.raw", "alpha" in test ? test.alpha : "xc:white", "rgba:in.raw", "-combine"]),
            ...("before" in test ? test.before : []),
            ...(geometry ? ["-extent", geometry] : []), "-channel", red ? "R" : "10", "-separate", "+channel",
            ...(info ? ["-format", "%wx%h", "info:out"] : ["-depth", String(depth), "gray:out"])];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr })
            .toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
    });
}
