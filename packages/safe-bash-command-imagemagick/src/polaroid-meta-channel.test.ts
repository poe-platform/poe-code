import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI extra-channel polaroids.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { separate: false, geometry: "31x30 srgba 5.1" },
        { separate: true, geometry: "31x30 gray  2.1" },
        { depth: "8", size: 3720, hash: "3d8479afa01e5cc0387b951a6d313ac3f4652f4ce9ec2a425faa68347a418a39" },
        { separate: true, depth: "8", size: 930 },
        { angle: "15", separate: true, geometry: "39x38 gray  2.1" },
        { angle: "15", depth: "8", size: 5928, hash: "13896ee655c8b9dde2f4439c57863b8f64e32a2e49e89dcb7aa7760b13295399" },
        { angle: undefined, separate: true, geometry: "3x2 gray  2.1" },
        { angle: undefined, separate: true, depth: "8", size: 6, hash: "103b8cedfc73e33393ad827c2d99b1b1ff2b0384ef85198f05e8769de45cd725" },
        { drop: true, depth: "8", size: 3720, hash: "3d8479afa01e5cc0387b951a6d313ac3f4652f4ce9ec2a425faa68347a418a39" }
    ])(`${mode}: renders extra-channel polaroids (depth=$depth, separate=$separate)`, async ({ depth, size, hash, geometry, separate, drop, ...test }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const angle = "angle" in test ? test.angle : "0";
        const argv = ["-size", "3x2", "xc:#404040", "-duplicate", "3", "xc:#c0c0c0", ...(drop ? ["-delete", "4"] : []), "-combine",
            ...(angle === undefined ? [] : ["-polaroid", angle]),
            ...(separate ? ["-channel", "Meta0", "-separate", "+channel"] : []),
            ...(depth ? ["-depth", depth, separate ? "gray:-" : "rgba:-"] : ["-format", "%wx%h %[channels]", "info:"])];
        const argumentValues = createCommandArguments(argv);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(data) { chunks.push(data.slice()); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
            : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : Buffer.concat(chunks);
        if (geometry) expect(output.toString()).toBe(geometry);
        else {
            expect(output.length).toBe(size);
            if (hash) expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
            if (separate && angle === "0") expect(Array.from(output.subarray(10 * 31 + 10, 10 * 31 + 14))).toEqual([26, 48, 48, 22]);
        }
    });
}
