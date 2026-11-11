import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, raw RGBA16 MSB samples.
for (const operator of ["-level", "+level"] as const) {
    for (const space of ["Gray", "LinearGray", "sRGB"] as const) {
        for (const channel of ["R", "Gray", "G", "B", "RGB", "A"]) {
            it.each([false, true])(`${space} ${operator} channel ${channel}, reset=%s`, async reset => {
                const fs = new MemoryFileSystem();
                const args = createCommandArguments(["xc:#b0377580", "-colorspace", space,
                    "-channel", channel, operator, "15%,85%,1.5", ...(reset ? ["+channel"] : []),
                    "-depth", "16", "-endian", "MSB", "rgba:/out"]);
                let stderr = "";
                const result = await createMagickCommand().execute({ command: "magick", args: args.args,
                    argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
                expect(result.exitCode).toBe(0);
                expect(stderr).toBe("");
                const minus = operator === "-level";
                const alpha = channel === "A" ? minus ? "a1df" : "6621" : "8080";
                let colors: string;
                if (space === "sRGB") {
                    colors = ["R", "Gray", "RGB"].includes(channel) ? minus ? "d761" : "8d27" : "b0b0";
                    colors += ["G", "RGB"].includes(channel) ? minus ? "34dd" : "3859" : "3737";
                    colors += ["B", "RGB"].includes(channel) ? minus ? "945b" : "5e18" : "7575";
                } else {
                    const intensity = ["R", "Gray", "RGB"].includes(channel)
                        ? space === "Gray" ? minus ? "691a" : "4903" : minus ? "0000" : "2f0b"
                        : space === "Gray" ? "558a" : "21eb";
                    colors = intensity.repeat(3);
                }
                expect(Buffer.from(await fs.readFile("/out")).toString("hex")).toBe(colors + alpha);
            });
        }
    }
}
