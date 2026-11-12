import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
const cases = [
    { name: "translucent", destination: "#aa443380", source: "#2468acb0", compose: "SoftBurn", hex: "000000d8" },
    { name: "opaque dark", destination: "#aa4433", source: "#2468ac", compose: "SoftBurn", hex: "000000ff" },
    { name: "opaque light", destination: "#94daf5", source: "#f6cc83", compose: "SoftBurn", hex: "90d1ecff" },
    { name: "Over control", destination: "#aa443380", source: "#2468acb0", compose: "Over", hex: "3d6196d8" },
    { name: "Dst control", destination: "#aa443380", source: "#2468acb0", compose: "Dst", hex: "aa443380" },
    // Additional alpha and division boundaries verified with ImageMagick 7.1.2-31 Q16-HDRI.
    { name: "zero source", destination: "#ffffff", source: "#000000", compose: "SoftBurn", hex: "000000ff" },
    { name: "zero destination", destination: "#000000", source: "#ffffff", compose: "SoftBurn", hex: "000000ff" },
    { name: "transparent destination", destination: "#94daf500", source: "#f6cc8380", compose: "SoftBurn", hex: "00000080" },
    { name: "transparent source", destination: "#94daf580", source: "#f6cc8300", compose: "SoftBurn", hex: "00000080" },
    { name: "both transparent", destination: "#94daf500", source: "#f6cc8300", compose: "SoftBurn", hex: "00000000" },
    { name: "translucent light", destination: "#ffffff80", source: "#ffffffb0", compose: "SoftBurn", hex: "545454d8" },
    { name: "white source", destination: "#94daf5", source: "#ffffff", compose: "SoftBurn", hex: "ffffffff" },
];

for (const route of ["command", "retained", "buffered", "sync"] as const) {
    const commands = cases.map(({ name, destination, source, compose, hex }) => ({ name, hex,
        argv: ["-size", "1x1", `xc:${destination}`, `xc:${source}`, "-compose", compose, "-composite", "-depth", "8", "rgba:-"] }));
    commands.push({ name: "offset flatten", hex: "000000b8000000e9000000e9",
        argv: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")",
            "-background", "#33553370", "-compose", "SoftBurn", "-flatten", "-depth", "8", "rgba:-"] });
    it.each(commands)(`${route}: $name matches native pixels`, async ({ argv, hex }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = route === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : route === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = route === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
