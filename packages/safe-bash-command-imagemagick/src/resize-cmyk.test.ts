import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI RGBA8 reference pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "CMYK", operation: ["-resize", "1x1"], output: "rgba", expected: "45416a90" },
        { space: "CMYK", operation: ["-scale", "1x1"], output: "rgba", expected: "45416a90" },
        { space: "CMYK", operation: ["-thumbnail", "1x1"], output: "rgba", expected: "45416a90" },
        { space: "CMYK", operation: ["-filter", "point", "-resize", "1x1"], output: "rgba", expected: "a0403060" },
        { space: "CMYK", operation: ["-filter", "triangle", "-resize", "1x1"], output: "rgba", expected: "45416a90" },
        ...["-resize", "-scale", "-thumbnail"].map(operation => ({ space: "CMYK", operation: [operation, "1x1"], output: "cmyka", expected: "80883c7490" })),
        { space: "sRGB", operation: ["-resize", "1x1"], output: "rgba", expected: "4b406590" },
    ])(`${mode}: filters $space $operation $output`, async ({ space, operation, expected, output }) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Buffer>();
        const args = ["xc:#204080c0", "xc:#a0403060", "+append", "-colorspace", space, ...operation, ...(output === "rgba" ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${output}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const actual = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(actual).toString("hex")).toBe(expected);
    });
}
