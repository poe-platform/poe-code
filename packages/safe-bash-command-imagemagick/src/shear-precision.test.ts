import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference input and output.
const source = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex"),
]);

const cases = [
    { operations: ["-shear", "20x0", "-depth", "16", "-endian", "MSB"], destination: "rgba", expected: "bda7cd09e6adffffa4bf77b4746effffa989606a6b4cffffdff8c7c2d3ddffffe830a5abb1c3ffffb2e58c59d972ffffa000a000576fffffffffffffffffffff" },
    { operations: ["-shear", "20x0", "-format", "%[fx:mean.r]"], destination: "info", expected: "0.769043" },
    { operations: ["-shear", "20x0", "-depth", "8"], destination: "rgba", expected: "bdcce6ffa47774ffa9606bffdfc7d3ffe7a5b1ffb28cd9ff9f9f57ffffffffff" },
    { operations: ["-depth", "16", "-endian", "MSB"], destination: "rgba", expected: "30306060b0b08080a0a040402020e0e0808020205050b0b0c0c010103030606077773333bbbb9090808080802020c0c0" },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`${mode}: retains shear precision for $operations`, async ({ operations, destination, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.pam", source], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", source);
        await fs.writeFile("/out", keep);
        const args = ["/in.pam", ...operations, `${destination}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(Buffer.from(output).toString(destination === "info" ? "utf8" : "hex")).toBe(expected);
    });
}
