import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// One RGB pixel (112233), valid chunk CRCs, and a genuine sRGB control profile.
const fixtures = [
  { name: "iccSmall", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEWlDQ1Bwcm9mAAB4nEtMSgYAAk0BJ8MEnDYAAAAMSURBVHicYxBUMgYAAK4AZxUeoV8AAAAASUVORK5CYII=" },
  { name: "iccprofilebadmagic", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAABcGlDQ1Bwcm9mAAB4nHWRPUvDUBSGH6tSsRUHHUQcOlRxaEEURDetiEvRUiv4tTRp0wppGtIWKa6Ci4PgILr4NfgPdBVcFQRBEUScHf1apMRzrVCRei835+HNfQ8nb8ATNfVcoWkMclbRiU9FAvMLiwHvMz68skcZmp6JTY7HYlH+XR+3NKh6E1a9/r9Xd/lS6YIODS3Cw7rtFIVlGqKrRVvxpnCnnk2mhA+EQ44MKHypdK3KT4ozVX5T7CTiE+BRPQOZX6z9Yj3r5IT7hYM5s6T/zKO+xJ+25maldsvpoUCcKSIE0CixgkmRsFRLMqvvG/j2TZMXjy5PmzKOODJkxRsStSRd01IN0dOyTcoq9795FoyhwWp3fwSaH133tRe821DZct3PQ9etHEHjA5xbNX9echp5F32rpgX3oX0dTi9qmrYDZxvQdW8nneS31CjHYxjwcgJtC9BxDa1L1ax+3nN8B4k1+UVXsLsHfXK/ffkLXrtnvnj0Ca0AAAAMSURBVHicYxBUMgYAAK4AZxUeoV8AAAAASUVORK5CYII=" },
  { name: "iccvalid", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAABbmlDQ1Bwcm9mAAB4nHWRvUtCURjGf1phpOFQQ0SDQ0WDQiREbWWDi4SYQVaLXq8aqF3uVUJag5YGoSFq6WvoP6g1aC0IgiKIaG7sawm5vUcFJeoczn1/PPc8L+99Ljgjea1gdc5AoVgyY+GQbymx7HO94sYle5pgUrOM2Wg0wr/r6x6HqncB1ev/e38ud1q3NHB0C09qhlkSlmmIbJQMxTvC/VoumRY+EvabMqDwtdJTDX5RnG3wh2IzHpsDp+rpy7Zxqo21nFkQHhMeLuTLWnMe9SUevbi4IHVQzhAWMcKE8JGizBp5SgSkFiWzv33jdd886+LR5GlQwRRHlpx4/aKWpasuNSO6LjtPReX+O08rE5xodPeEoOvZtt9HwLULtaptfx/bdu0EOp7gstjyr0tOU5+iV1va8CF4t+D8qqWl9uBiGwYejaSZrEsdcpyZDLydQW8C+m6hZ6WRVfM9pw8Q35RfdAP7BzAq972rP1o3aDPL8cLqAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" }
];

for (const mode of ["buffered", "command"] as const) {
  it.each(fixtures)(`drops invalid decompressed PNG ICC profiles: $name (${mode})`, async ({ name, base64 }) => {
    const input = Buffer.from(base64, "base64");
    const files = new Map([["/in.png", input], ["/out.png", Buffer.from("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    const warning = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, warning).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.icc).toEqual(name === "iccvalid" ? decodeImage(input).icc : undefined);
    expect(Buffer.from(output).includes(Buffer.from("iCCP"))).toBe(name === "iccvalid");
    if (name === "iccvalid") {
      expect(decoded.icc).toHaveLength(588);
      expect(warning).toBe("");
    }
    else expect(warning).toContain("iCCP");
  });
}
