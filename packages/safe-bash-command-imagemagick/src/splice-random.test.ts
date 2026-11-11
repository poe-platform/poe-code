import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI x86_64, seeded RGBA8 output.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (13 * i + 9) % 256))]);
const input16 = Buffer.concat([Buffer.from("P7\nWIDTH 4\nHEIGHT 3\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), Buffer.from(Array.from({ length: 48 }, (_, i) => {
    const value = (13 * i + 9) % 256 * 257 + 1;
    return [value >> 8, value & 255];
}).flat())]);
for (const mode of ["buffered", "retained", "sync", "command"]) {
    it.each([
        { seed: "123", geometry: "2x2-2-2", method: "Random", hash: "c0e5fdac30ee8fc2005e653dc25c2cbaddf12c87c9694c07b2b5a2866bb8b396", first: "414e5bff", fifth: "a5b2bfff" },
        { seed: "123", geometry: "2x2-2-2", method: "Edge", hash: "491964ff13c2207d81f5bfe38ab71bbdae0f5761f2c79e9f1634268d7e7b0c63", first: "091623ff", fifth: "7e8b98ff" },
        { seed: "17", geometry: "2x2-2-2", method: "Random", hash: "98be6cd2f0d94d6ac9802692733bcabb35f847226e9de8150caeb3075346a83d", first: "f3000dff", fifth: "091623ff" },
        { seed: "0", geometry: "2x2-2-2", method: "Random", hash: "40aa78e52ee7647fb9ee1fe7c42fba31d2069dd8f585b576b5945ea4b2be6991", first: "a5b2bfff", fifth: "303d4aff" },
        { seed: "-2", geometry: "2x2-2-2", method: "Random", hash: "3b3744c233e976b4589b1cc5d2daa35134aa75daf0633b39f09dc7bd2e0b4173", first: "576471ff", fifth: "b6c3d0ff" },
        { seed: "123", geometry: "2x2-1-2", method: "Random", hash: "dbe3d46f4e5c0b4515c689adff7df5346d29d5ebc5ebe439ffea5eb074dca357", first: "cc1177ff", fifth: "a5b2bfff" },
        { seed: "123", geometry: "2x2+1-2", method: "Random", hash: "25ec1339860484b3f24ca7b06761b3929665b4c11e47615b64c5f63fb4979c77", first: "414e5bff", fifth: "687582ff" },
        { seed: "123", geometry: "2x2+5+1", method: "Random", hash: "610df2bd6255add77f05a75beab3c906576c9212f4e2873d747bb5ed695b2dd3", first: "091623ff", fifth: "414e5bff" },
        { seed: "123", geometry: "2x2-2-2", method: "Random", depth: 16, hash: "ccfa845bdbd8517f5a6cfd1fe43edf9fddf01385741812710f791582c82a008e", first: "a9aab6b7c3c4d0d1", fifth: "d9dae6e7f3f40001" },
    ])(`matches seed $seed splice $geometry $method pixels (${mode})`, async ({ seed, geometry, method, depth = 8, hash, first, fifth }) => {
        const source = depth === 16 ? input16 : input;
        const files = new Map([["/in.ppm", source]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", source);
        const args = ["/in.ppm", "-seed", seed, "-background", "#cc1177", "-virtual-pixel", method, "-splice", geometry, "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(bytes).toHaveLength(6 * 5 * depth / 2);
        expect(Buffer.from(bytes.slice(0, depth / 2)).toString("hex")).toBe(first);
        expect(Buffer.from(bytes.slice(depth * 2, depth * 2.5)).toString("hex")).toBe(fifth);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}
