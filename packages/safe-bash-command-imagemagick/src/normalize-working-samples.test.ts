import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including unchanged zero-add and linear controls.
const computed = (amount: string) => ["-size", "1x1", "xc:#778899", "(", "+clone", "-channel", "B",
    "-evaluate", "add", amount, "+channel", ")", "+append"];
const cases = [
    { name: "blue normalize", input: computed("32"), operation: ["-channel", "B", "-normalize", "+channel"], hex: "7788007788ff" },
    { name: "default normalize", input: computed("32"), operation: ["-normalize"], hex: "00ffff00ffff" },
    { name: "default contrast", input: computed("32"), operation: ["-contrast-stretch", "0%x0%"], hex: "00ffff00ffff" },
    { name: "explicit 16-bit", input: ["-size", "1x1", "xc:#777788889999", "xc:#7777888899b9", "+append"], operation: ["-normalize"], hex: "00ffff00ffff" },
    { name: "zero add", input: computed("0"), operation: ["-normalize"], hex: "778899778899" },
    { name: "linear control", input: computed("32"), operation: ["-linear-stretch", "0x0"], hex: "778899778899" },
    ...[["-normalize"], ["-contrast-stretch", "0%x0%"]].map(operation => ({
        name: operation.join(" ") + " fractional", input: computed("0.25"), operation, text: "2x1:2:39321,39321.25",
    })),
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name uses working samples`, async test => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const output = "text" in test
            ? ["-precision", "14", "-format", "%wx%h:%k:%[fx:p{0,0}.b*65535],%[fx:p{1,0}.b*65535]", "info:/out"]
            : ["-depth", "8", "rgb:/out"];
        const argv = [...test.input, ...test.operation, ...output];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes)).toEqual("text" in test ? Buffer.from(test.text!) : Buffer.from(test.hex!, "hex"));
    });
}
