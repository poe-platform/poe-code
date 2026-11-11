import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the composited center pixel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const channel of ["", "K", "Default"]) {
        it.each([
            { geometry: "1x1+1+0", black: "5050507d2b00000000", cmyka: "e674a050ff", rgba: "115f41ff" },
            { geometry: "1x1+0+1", black: "000000002b7d505050", cmyka: "5e173200ff", rgba: "a1e8cdff" },
            { geometry: "1x1", black: "000000002b00000000", cmyka: "da357500ff", rgba: "25ca8aff" },
        ])(`${mode}: CMYK frame $geometry shades black ink (${channel || "implicit channels"})`, async ({ geometry, black, cmyka, rgba }) => {
            for (const output of ["gray", "cmyka", "rgba"]) {
                const argv = ["xc:#345caa80", "-colorspace", "CMYK", "-mattecolor", "#da3575",
                    ...(channel ? ["-channel", channel] : []), "-frame", geometry,
                    ...(output === "gray" ? ["-channel", "K", "-separate"] : output === "rgba" ? ["-colorspace", "sRGB"] : []),
                    "-depth", "8", `${output}:/out`];
                const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
                let stderr = "";
                const argumentValues = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                const bytes = Buffer.from(mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
                if (output === "gray") expect(bytes.toString("hex")).toBe(black);
                else {
                    const channels = output === "cmyka" ? 5 : 4;
                    expect(bytes).toHaveLength(9 * channels);
                    expect(bytes.subarray(0, channels).toString("hex")).toBe(output === "cmyka" ? cmyka : rgba);
                    expect(bytes.subarray(4 * channels, 5 * channels).toString("hex")).toBe(output === "cmyka" ? "c8aa6f2bff" : "2e4778ff");
                }
            }
        });
    }
}
