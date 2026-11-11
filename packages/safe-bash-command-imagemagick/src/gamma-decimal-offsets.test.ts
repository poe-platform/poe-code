import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#345caa80, RGBA8 pixels and %[gamma].
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-gamma", "+gamma"]) {
        it.each([
            ...["2.0-1", "2.0+1", "2.0-1-2", "2.0e0-1", "2.-1", "2", "2x3-1"].map(value =>
                ({ value, minus: "7399d0b5", plus: "0b217140", gamma: "0.909091" })),
            ...["2.5+1", "2.5"].map(value =>
                ({ value, minus: "87aad9c2", plus: "05145d2e", gamma: "1.13636" })),
            { value: "2.0e-1+1", minus: "00022208", plus: "bad0ebde", gamma: "0.0909091" },
            { value: "-2.0-1", minus: "ffffffff", plus: "ffffffff", gamma: "-0.909091" },
            ...["2-1", "2e0-1", "2.0foo-1"].map(value =>
                ({ value, minus: "", plus: "", gamma: "" })),
        ])(`${mode}: ${option} $value preserves native decimal-offset grammar`, async ({ value, minus, plus, gamma }) => {
            const expected = option === "-gamma" ? minus : plus;
            const sentinel = new TextEncoder().encode("KEEP");
            const files = new Map([["/pixels", sentinel], ["/gamma", sentinel]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["xc:#345caa80", option, value, "-depth", "8", "-write", "rgba:/pixels", "-format", "%[gamma]", "info:/gamma"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const pixels = mode === "command" || mode === "retained" ? await fs.readFile("/pixels") : files.get("/pixels")!;
            const metadata = mode === "command" || mode === "retained" ? await fs.readFile("/gamma") : files.get("/gamma")!;
            expect(result.exitCode).toBe(expected ? 0 : 1);
            expect(Buffer.from(pixels).toString("hex")).toBe(expected || "4b454550");
            expect(new TextDecoder().decode(metadata)).toBe(gamma || "KEEP");
        });
    }
}
