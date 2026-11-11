import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())]);
// Native ImageMagick 7.1.2-35 Q16-HDRI, one thread, seed 42.
const spread = "7e8f94986989cd7b734a2ba9df6d6ca40d85ae158046acab1a28bdb6997d7f8594aad2822f7cb54a91aa418aad";
const edge = "0000c8153abfec8e674a2ba9df6d6cbc067bae158040b2ade0956cb6997d7f8594aad6822f7cb5dc976e418aad";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([["-spread", "2", "random"], ["-spread", "2", "edge"], ["-implode", "3", "random"]])(`${mode}: repeats seeded %s %s with %s virtual pixels`, async (operation, value, virtualPixel) => {
        const outputs: string[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input]]);
            const argv = ["-limit", "thread", "1", "-seed", "42", "/in.ppm", "-virtual-pixel", virtualPixel!, operation!, value!, "-depth", "8", "rgb:/out.raw"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!);
            outputs.push(output.toString("hex"));
            if (operation === "-spread") expect(outputs.at(-1)).toBe(virtualPixel === "random" ? spread : edge);
            else expect(output.subarray(21, 24).toString("hex")).toBe("4f98a8");
        }
        expect(new Set(outputs).size).toBe(1);
    });
}
