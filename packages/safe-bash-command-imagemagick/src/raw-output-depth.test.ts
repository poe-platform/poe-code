import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI oracle samples, in big-endian RGBA order.
const high = "010104018001ffff".repeat(3) + "0000fffe02bc7530" + "11121edd535ed903".repeat(4);
const low = "010480ff".repeat(3) + "00ff0375" + "111f53d8".repeat(4);
const alpha = "1234abcdff0080ff1234abcd55660080".repeat(2);
const inputs = {
    "png.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACEAYAAAAvOKEgAAAAJklEQVR4nGNgZGRhbGD8/x+dZmD4/49pT6kBg6CQ3N3guJvMuGgAqSQVn6v7hY8AAAAASUVORK5CYII=", "base64"),
    "none.miff": Buffer.concat([
        Buffer.from("id=ImageMagick version=1.0\nclass=DirectClass colors=0 alpha-trait=Blend\ncolumns=4 rows=2 depth=16\ncolorspace=sRGB\ncompression=None\n\f\n:\x1a"),
        Buffer.from(high, "hex")
    ]),
    "alpha.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAGklEQVR4nGMQMll99j9Dw38QHZrG0MCALgAA+GUOa226QWwAAAAASUVORK5CYII=", "base64")
};

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "write"] as const) {
        it.each([
            ["png.png", ["-depth", "8"], "rgba", low],
            ["none.miff", ["-depth", "8"], "rgba", low],
            ["png.png", ["-depth", "16", "-endian", "MSB"], "rgba", high],
            ["none.miff", ["-depth", "16", "-endian", "MSB"], "rgba", high],
            ["none.miff", [], "PNG64", high],
            ["alpha.png", ["-depth", "8"], "rgba", alpha],
            ["png.png", ["-endian", "MSB"], "rgba", high],
            ["alpha.png", ["-depth", "16", "-endian", "MSB"], "rgba", [...Buffer.from(alpha, "hex")].map(value => value.toString(16).padStart(2, "0").repeat(2)).join("")]
        ] as [keyof typeof inputs, string[], string, string][])(`${mode} ${destination}: %s %j %s`, async (input, options, coder, expected) => {
            const files = new Map<string, Uint8Array>([[`/${input}`, inputs[input]], ["/out.raw", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${coder}:${destination === "stdout" ? "-" : "/out.raw"}`;
            const args = [`/${input}`, ...options, ...(destination === "write" ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = destination === "stdout"
                ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result ? result.stdoutBytes! : new Uint8Array()
                : mode === "command" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
            if (coder === "PNG64") {
                const decoded = decodeImage(output);
                expect([decoded.width, decoded.height]).toEqual([4, 2]);
                const expectedBytes = Buffer.from(expected, "hex");
                expect([...decoded.data16!]).toEqual(Array.from({ length: expectedBytes.length / 2 }, (_, i) => expectedBytes.readUInt16BE(i * 2)));
            } else {
                expect(Buffer.from(output).toString("hex")).toBe(expected);
            }
        });
    }
}
