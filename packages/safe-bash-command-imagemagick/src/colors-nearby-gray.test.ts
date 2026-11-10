import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the dither cache can merge colors even
// when the input already fits the requested palette.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { colors: ["#101010", "#111111"], operations: ["-colors", "2"], expected: "101010ff101010ff" },
        { colors: ["#111111", "#101010"], operations: ["-colors", "2"], expected: "111111ff111111ff" },
        { colors: ["#101010", "#111111"], operations: ["-colors", "2"], expected: "PseudoClass Gray |gray  2.0|1;", info: true },
        { colors: ["#101010", "#111111"], operations: [], expected: "101010ff111111ff" },
        { colors: ["#101010", "#dddddd"], operations: ["-colors", "2"], expected: "101010ffddddddff" },
        { colors: ["#131313", "#141414"], operations: ["-colors", "2"], expected: "131313ff141414ff" },
        { colors: ["#101010", "#111111"], operations: ["-dither", "FloydSteinberg", "-colors", "2"], expected: "101010ff101010ff" },
        { colors: ["#101010", "#131313"], size: "1x3", operations: ["-colors", "2"], expected: "101010ff".repeat(6) },
        { colors: ["#101010", "#131313"], size: "1x3", operations: ["-dither", "FloydSteinberg", "-colors", "2"], expected: "101010ff101010ff101010ff131313ff101010ff131313ff" },
        { colors: ["#101010", "#111111"], operations: ["+dither", "-colors", "2"], expected: "101010ff111111ff" },
        { colors: ["#101010", "#111111"], operations: ["-dither", "None", "-colors", "2"], expected: "101010ff111111ff" },
    ])(`matches nearby gray palette membership: $colors $operations info=$info (${mode})`, async ({ colors, size, operations, expected, info }) => {
        const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("/out")!);
        const args = [...(size ? ["-size", size] : []), ...colors.map(color => `xc:${color}`), "+append", ...operations,
            ...(info ? ["-format", "%r|%[channels]|%k;", "info:/out"] : ["-depth", "8", "rgba:/out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString(info ? "utf8" : "hex")).toBe(expected);
    });
}
