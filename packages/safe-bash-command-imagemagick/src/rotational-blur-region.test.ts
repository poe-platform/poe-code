import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDU6MzYrMDA6MDDZwku5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ1OjM2KzAwOjAwqJ/zBQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0NTozNiswMDowMP+K0toAAACXSURBVBjTXcohD0FhGMXxd49iNkEQTLMbXaYYm0i4URUkX0H2HUTfwURFd6OhsQmCs4nslv9myr3buzedc57nV3LduTtc30k8uX+t0Us/ldbw+Mh2g9OrU41Gl189HpukJbCXJIA8Z5LOxba8tAEXwJqkJoB5jyeQBDCVtDDvgKQNsA7gyiRtAzgFbj40oC8pC2AZiIr9B68y0SJ6hpAJAAAAAElFTkSuQmCC", "base64");
// ImageMagick 7.1.2-31 Q16-HDRI, PNG32 output decoded to RGBA8.
const cases = [
    { name: "regional", operations: ["-region", "4x3+2+2", "-rotational-blur", "38", "+region"], rgba: "LhYLAF9eFUkhMkIYQWyY1BY9ZKMMFyIAOk9kLlmHtOorV4O5mxktdQwPEwAMExoAQWaQz7gzTot2ehxaAAAAAFOArOUZQ2yhjxgocCs3RCxWhbQ5KlmIt/koV4a15BNCJjVEESQ6UQAQNVuceH8aWCk1QSdUg7KpAAAAAOEQP26w3w49a5rJ+TReicglEB4AYXgTUxIZHw9NfKvZDTxrmgAAAACYx/YlZ5XE9CFMd7CaGDh/EhcDABQhLgo3XorGETdVlVRtGVEhLigAS3mm3BlAZ6uEDS1nMD0CNgsVIAA0VH3BnShAfWJgFEwVGwwIBxAaAA8lR5N4CCdi" },
    { name: "unmasked", operations: ["-rotational-blur", "38"], rgba: "12g1NsyDQkhRgK9HOmmYkC1ci4I1ZJM8aZjHVU59rJ83ZpXA3kA8Z5jH9hNWhbQlcWCPirNmbZDiokBQAAAAAGGQv28uXYy03VQ7Wp3M+x5WhbQ5KlmIt/koV4a15BNCb57NR0p5qHsjUoF70qkwXZnI9yJUg7KpAAAAAOEQP26w3w49a5rJvjJhkIh1MWBRxvUqPo697BRNfKvZDTxrmgAAAACYx/YlY5LB7ylYh7W3KVhexvUkGD5tnEBOYZChM2JtkGqZQ05unYhLSXintyBPfnyYH056qdgHFzRjkjdtUYB5mF5jgtaDPEe25TcZIlGAM0knVlyKF0Zx" },
    { name: "zero angle", operations: ["-region", "4x3+2+2", "-rotational-blur", "0", "+region"], rgba: "AAAAAFxzDUkZISoYRXOg1BM8ZaMAAAAANURULlyLuuopVIC5pBAxdQAAAAAAAAAAQG2az8kkSYt3khlaAAAAAFeGtOUROmOhnAwtcDJBUCwAAAAAKlmIt/koV4a15BNCERcdEQAAAAANNV2cdI8XWCw5RidWhbTjAAAAAOEQP26w3w49bJvK+ThlksgAAAAAbIYUUw8UGg9RgK/eDTxrmgAAAACYx/YlZ5bF9CBKdbC1GTx/AAAAAAoNEQo2Y4/GBy1UlWmCElEAAAAATnyq3BtFb6uNBiRnQFIDNgAAAAAxXYnBshc6fWF5D0wICg0IAAAAAAUrUpOEAiBi" },
    { name: "disabled alpha", operations: ["-alpha", "off", "-region", "4x3+2+2", "-rotational-blur", "38", "+region"], rgba: "AC9e/7zrGv+Luun/R3al/xZFdP/SATD/odD//12Mu/8sW4r/6BdG/7fmFf9zotH/QnGg//4tXP/N/Cv/ibjn/1iHtv8UQ3L/4xJB/5/O/f9pmMf/KlmI//koV/+15BP/hLPi/0Bvnv8PPm3/y/op/5rJ+P9birn/JVSD/+EQP/+w3w7/bJvK/ztqmf/3JlX/xvUk/4Kx4P9Me6r/DTxr/9wLOv+Yx/b/Z5bF/yNSgf/yIVD/rt0M/32s2/85aJf/CDdm/8TzIv+TwvH/T36t/x5NfP/aCTj/qdgH/2WUw/80Y5L/8B9O/7/uHf97qtn/Snmo/wY1ZP/VBDP/" },
    { name: "red channel", operations: ["-channel", "R", "-region", "4x3+2+2", "-rotational-blur", "38", "+region", "+channel"], rgba: "AC9eAF/rGkkUuukYQ3al1BhFdKMAATAALdD/LluMu+orW4q5oRdGdQDmFQAAotEAR3Ggz7ctXIt8/CtaALjnAFiHtuUXQ3KhmhJBcDLO/SxWncwAKlmIt/koV4a15BNCELPiEQBvngASPm2cdvopWCvJ+CdUhbTjAFSDAOEQP26w3w49bJvK+TdqmcgAJlUAbPUkUxCx4A9NgK/eDTxrmgALOgCYx/YlZ5bF9CFSgbCmIVB/AN0MAAes2wo6aJfGETdmlVXzIlEAwvEATX6t3BtNfKt9CThnQNgHNgCUwwA7Y5LBnB9OfWbuHUwJqtkIAHmoABU1ZJNyBDNi" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`matches every translucent rotational blur pixel: $name, ${mode}`, async ({ operations, rgba }) => {
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", ...operations, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([9, 7]);
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}
