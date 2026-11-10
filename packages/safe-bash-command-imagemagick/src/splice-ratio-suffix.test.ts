import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7 output for the 4x3 PPM below, including unchanged plain geometry.
const cases = [
    { geometry: "1x2:3", bytes: 108, hash: "608ed360cf88a208cd3acd1ba999e12226fadd760fe17735d65a16fc4f8bf6e1" },
    { geometry: "1x2/3", bytes: 144, hash: "67f416bf5acde153c8903ef4d2a23d4bce425a180d2ad7d88dc37155b368386a" },
    { geometry: "1x2", bytes: 75, hash: "c6c38c7bd1edd359650855837658a8d69298439db892dc14389a74d2f6341f69" },
    { geometry: "2x1:3", bytes: 120, hash: "17bfc294c747e8b4f3a0c408d3923c14f49acb8af73cd8d5157d4c19a0dcf615" },
    { geometry: "2x1/3", bytes: 144, hash: "67f416bf5acde153c8903ef4d2a23d4bce425a180d2ad7d88dc37155b368386a" },
    { geometry: "1x2:3+1+1", bytes: 108, hash: "608ed360cf88a208cd3acd1ba999e12226fadd760fe17735d65a16fc4f8bf6e1" },
    { geometry: "1x2/3+1+1", bytes: 144, hash: "67f416bf5acde153c8903ef4d2a23d4bce425a180d2ad7d88dc37155b368386a" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`resolves splice $geometry (${mode})`, async ({ geometry, bytes, hash }) => {
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 3\n255\n"),
            ...Array.from({ length: 36 }, (_, i) => (i * 53 + 9) % 256)]);
        const files = new Map([["/in.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.ppm", "-splice", geometry, "-depth", "8", "rgb:/out"];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(bytes);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
