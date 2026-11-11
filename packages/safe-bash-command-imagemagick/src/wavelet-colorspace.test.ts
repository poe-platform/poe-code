import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"] as const) {
    it.each([
        ["HSL", "rgb", "25%", "69f0d365792e2141023e3cfbab4926209f96e702446c1f4294d6c1fe1e2f3e6d"],
        ["Lab", "rgb", "25%", "08a6b190890644628c234a9ee8088618a233c0f349aadd2a8d53d528c754145a"],
        ["CMYK", "cmyk", "25%", "789fd09afeb0eef94de6b53291ad3f7fa3022bc0375583f5131ef26b0db3f08b"],
        ["HSL", "rgba", "0", "99eee97ffb9bf060f58b5b008abc6a0ef3726593af22cc17d6c80cf880a1538e"],
        ["HSL", "rgba", "25%", "eb60e0060943afc8b9c984b5329f6dd23498bea66c94678ded1372ff786a869b"],
        ["Lab", "rgba", "0", "306182e30a23a6d7765e86dc7de47a80bdfa0bb5fc18161e8b9aebf09adfbde2"],
        ["Lab", "rgba", "25%", "08cdaacd17a79d96845267b90458df6c2b5bb597b456ec8612ec24d5cbcf5479"],
        ["CMYK", "cmyka", "0", "afdd7b6bed373d1e003e72f07991babc8340ad699d2e34fa0716754661b837af"],
        ["CMYK", "cmyka", "25%", "572aab36345258034a29ec99e3c1dc23a2ccbae98faf66180afc919e37cf071d"],
    ])(`denoises %s %s working channels at %s (${mode})`, async (space, format, threshold, expected) => {
        const alpha = format.endsWith("a");
        const input = Buffer.concat([Buffer.from(alpha ? "P7\nWIDTH 7\nHEIGHT 5\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n" : "P6\n7 5\n255\n"), Buffer.from(Array.from({ length: alpha ? 140 : 105 }, (_, i) => (i * 41 + 51) % 256))]);
        const files = new Map([["/in.ppm", input]]), fs = createMemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-colorspace", space, "-wavelet-denoise", threshold, "-depth", "8", `${format}:/out`];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
        }) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        // Native ImageMagick 7.1.2 (31/35) Q16-HDRI, depth-8 raw output.
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
