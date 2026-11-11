import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: geometry and complete 8-bit RGBA output.
const defaults = "c373566d15ca487b1ed4de45f62e9356fd168ca26c61534c4a82450e1f7540a8";
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ...["R", "G", "B", "RGB"].map(channel => ({ options: ["-channel", channel], empty: true, hash: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119" })),
        { options: ["-channel", "A"], hash: "bd415ed894e70f6f43f5106baa36b2295bdf999da8e93d10722167be12c23a4b" },
        { options: ["-channel", "RA"], hash: "1e4ad1d893c8a97e722de3bd5f63bcfade673516a527e3e6319a6403b887eb76" },
        { options: ["-channel", "RGBA"], hash: defaults },
        { options: ["-channel", "R", "+channel"], hash: defaults },
        { options: [], hash: defaults },
        { options: ["-channel", "RA"], angle: "12", geometry: "44x42|44x42-4-5", size: 7392, hash: "87a5244d9849eca3146375bd837d479085da710fec1493ce2bd160c15e58572e" },
        { options: ["-channel", "A"], angle: "12", geometry: "44x42|44x42-4-5", size: 7392, hash: "483bb2adf668135fc8b1e0223792c33097c22875d494910a585c299b55be67d2" },
        { options: ["-channel", "R"], angle: "12", geometry: "1x1|44x42-1-1", empty: true, hash: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119" },
        { options: ["-set", "caption", "Hi", "-channel", "A"], geometry: "36x47|36x47+0-1", size: 6768, hash: "6410aa1085c2da5e7c321290cc31f1cfcaebc9b0a68b322ba75e7c83beba204a" },
        { options: ["-set", "caption", "Hi", "-channel", "RA"], geometry: "36x47|36x47+0-1", size: 6768, hash: "54588409118c9c794937ed81f03da20803238b3bfc285a126f1fbbe90c421060" },
        { options: ["-background", "blue", "-bordercolor", "yellow", "-channel", "GA"], hash: "a962dee97b294945b99a9dd2a53887f5a7edc336f2431ecf4c5a647f9327fe05" },
    ])(`${mode}: honors polaroid channels $options, angle=$angle`, async ({ options, hash, empty = false, angle = "0", geometry = empty ? "1x1|36x34-1-1" : "36x34|36x34+0-1", size = empty ? 4 : 4896 }) => {
        for (const raw of [false, true]) {
            const argv = ["-seed", "7", "-size", "8x6", "xc:red", ...options, "-polaroid", angle,
                ...(raw ? ["-depth", "8", "rgba:out"] : ["-format", "%wx%h|%g", "info:out"])];
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(argv, files)
                : mode === "buffered" || mode === "retained" ? await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files)
                : await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
            expect(result.exitCode, stderr || ("stderr" in result ? String(result.stderr) : "")).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(raw ? createHash("sha256").update(output).digest("hex") : new TextDecoder().decode(output))
                .toBe(raw ? hash : geometry);
            if (raw) expect(output.byteLength).toBe(size);
            expect(("stderr" in result ? String(result.stderr) : stderr).includes("geometry does not contain image")).toBe(empty);
        }
    });
}
