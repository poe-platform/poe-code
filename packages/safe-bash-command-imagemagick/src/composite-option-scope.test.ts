import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const cases = [
    { name: "top-level stereo", args: ["xc:red", "xc:lime", "-stereo", "+append", "-depth", "8"], option: "-stereo", hex: "" },
    { name: "top-level stegano", args: ["xc:red", "xc:lime", "-stegano", "0", "+append", "-depth", "8"], option: "-stegano", hex: "" },
    { name: "nested stereo", args: ["(", "xc:red", "xc:lime", "-stereo", "+0+0", ")"], option: "-stereo", hex: "" },
    { name: "nested stegano", args: ["(", "xc:red", "xc:lime", "-stegano", "0", ")"], option: "-stegano", hex: "" },
    { name: "composite stereo", args: ["composite", "-stereo", "+0+0", "xc:red", "xc:lime"], hex: "000000000000" },
    { name: "composite stegano", args: ["composite", "-stegano", "0", "xc:red", "xc:lime"], hex: "48026ddf2408" },
    { name: "ordinary append", args: ["xc:red", "xc:lime", "+append", "-depth", "8"], hex: "ff000000ff00" },
    { name: "option-like property values", args: ["xc:red", "-set", "comment", "-stereo", "-set", "label", "-stegano", "-depth", "8"], hex: "ff0000" }
];

for (const route of ["command", "fallback", "retained", "buffered", "sync"] as const)
for (const output of ["rgb:-", "rgb:out.raw"])
it.each(cases)(`${route}, ${output}: $name`, async ({ args, option, hex }) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out.raw", original]]);
    const memory = new MemoryFileSystem();
    const filesystem = route === "fallback" ? new Proxy(memory, { get(target, key) {
        if (key === "capabilities") return undefined;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } }) : memory;
    await filesystem.writeFile("/out.raw", original);
    const argv = [...args, output];
    let stdout = "", stderr = "", exitCode: number;
    if (route === "command" || route === "fallback") {
        const argumentValues = createCommandArguments(argv);
        ({ exitCode } = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }));
    } else {
        const result = route === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, route === "buffered" ? files : { filesystem, cwd: "/" });
        ({ exitCode, stderr } = result);
        stdout = Buffer.from(result.stdoutBytes ?? new TextEncoder().encode(result.stdout)).toString("hex");
    }
    expect(exitCode).toBe(option ? 11 : 0);
    if (option) expect(stderr).toContain(`unrecognized option '${option}'`);
    else expect(stderr).toBe("");
    expect(stdout).toBe(output === "rgb:-" ? hex : "");
    const bytes = route === "sync" || route === "buffered" ? files.get("out.raw")! : await filesystem.readFile("/out.raw");
    expect(Buffer.from(bytes).toString("hex")).toBe(option || output === "rgb:-" ? "4b454550" : hex);
});
