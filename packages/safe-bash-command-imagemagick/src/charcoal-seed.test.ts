import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes (-limit thread 1).
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { seed: "3", method: "random", hex: "9a9a9affcfcfcfff393939ff" },
        { seed: "4", method: "random", hex: "f0f0f0ff141414ff414141ff" },
        { seed: "3", method: "edge", hex: "fcfcfcff969696ff1c1c1cff" },
        { seed: "3", method: "random", width: 5, height: 4, geometry: "0x1", hash: "5871b11b21b643b195fd164d7615fc74cd40aac1c55ae152488d8c7cb2c5a1a3" },
        { seed: "3", method: "random", width: 3, height: 5, geometry: "2x1", hash: "d3d53f132cff400ead56b66e0399d340fbfbecc59e3793846579ca015adc829a" },
        { seed: "3", method: "random", width: 1025, height: 3, hash: "187c29fb5de78ad74947432244915784af8419a0fc0fdc25d45ef7204d43b4cc" },
        { seed: "3", method: "random", width: 5, height: 4, settings: ["-channel", "R"], hash: "9eeb0e0afb0262150538627218ba337881f0738d1ec04651d0629058afccc8d2" },
        { seed: "3", method: "random", width: 5, height: 4, settings: ["-region", "3x2+1+1"], hash: "6942ac39d373a33e9d051bbce4051f4c740cd4f7d8f7546e0e5831856835d355" },
        { seed: "3", method: "random", width: 1, height: 1, hash: "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e" },
    ])(`${mode}: charcoal %j`, async ({ seed, method, hex, width, height, geometry, settings, hash }) => {
        for (let repeat = 0; repeat < 3; repeat++) {
            const argv = [...(width ? ["/in.ppm"] : ["xc:#505860", "xc:#789080", "xc:#d0c0a0", "+append"]), "-seed", seed,
                "-virtual-pixel", method, ...(settings ?? []), "-charcoal", geometry ?? "1x1", "-seed", "99", "-depth", "8",
                mode === "command" ? "rgba:-" : "rgba:/out"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            if (width && height) {
                const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),
                    Uint8Array.from({ length: width * height * 3 }, (_, i) => (i * 73 + Math.floor(i / 7) * 19) % 256)]);
                files.set("/in.ppm", input);
                await fs.writeFile("/in.ppm", input);
            }
            const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const pixels = mode === "command" ? Buffer.concat(stdout)
                : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(hash ? createHash("sha256").update(pixels).digest("hex") : Buffer.from(pixels).toString("hex")).toBe(hash ?? hex);
        }
    });
}
