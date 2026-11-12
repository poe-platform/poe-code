import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: each input supplies its own intensity method.
const grouped = ["-respect-parentheses", "xc:black", "(", "xc:#ff2030"];
const cases = [
    { name: "scoped Brightness", inputs: [...grouped, "-intensity", "Brightness", ")", "xc:black"], hex: "00ff00" },
    { name: "scoped Average", inputs: [...grouped, "-intensity", "Average", ")", "xc:black"], hex: "007000" },
    { name: "scoped default", inputs: [...grouped, ")", "xc:black"], hex: "005100" },
    { name: "global Brightness", inputs: ["xc:black", "xc:#ff2030", "xc:black", "-intensity", "Brightness"], hex: "00ff00" },
    { name: "method before input", inputs: ["-respect-parentheses", "xc:black", "(", "-intensity", "Average", "xc:#ff2030", ")", "xc:black"], hex: "007000" },
    { name: "independent methods", inputs: ["-respect-parentheses", "(", "xc:#ff2030", "-intensity", "Average", ")", "(", "xc:#ff2030", "-intensity", "Brightness", ")", "xc:#ff2030"], hex: "70ff51" },
    { name: "outer override", inputs: [...grouped, "-intensity", "Brightness", ")", "xc:black", "-intensity", "Average"], hex: "007000" },
    { name: "outer reset", inputs: [...grouped, "-intensity", "Brightness", ")", "xc:black", "+intensity"], hex: "005100" },
    { name: "alpha input", inputs: ["-respect-parentheses", "xc:black", "xc:black", "xc:black", "(", "xc:#ff2030", "-intensity", "Average", ")"], output: "rgba", hex: "00000070" },
    { name: "meta input", inputs: ["-respect-parentheses", "xc:black", "xc:black", "xc:black", "xc:white", "(", "xc:#ff2030", "-intensity", "Average", ")"], after: ["-channel", "meta0", "-separate"], hex: "707070" },
    { name: "explicit colorspace", inputs: [...grouped, "-intensity", "Brightness", ")", "xc:black"], combine: ["+combine", "sRGB"], hex: "00ff00" }
];

for (const mode of ["magick", "convert", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: combine uses input intensity ($name)`, async ({ inputs, combine, after, output, hex }) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const argv = [...inputs, ...(combine ?? ["-combine"]), ...(after ?? []), "-depth", "8", `${output ?? "rgb"}:/out`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "magick" || mode === "convert" ? await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
