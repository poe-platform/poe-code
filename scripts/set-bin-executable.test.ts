import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { setBinExecutable } from "./set-bin-executable.mjs";

function modeOf(volume: InstanceType<typeof Volume>, filePath: string): number {
  return volume.statSync(filePath).mode & 0o777;
}

describe("setBinExecutable", () => {
  it("makes every declared bin executable", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/pkg/package.json": JSON.stringify({
        bin: { "pkg-generate": "dist/bin/generate.js", "pkg-serve": "dist/bin/serve.js" }
      }),
      "/repo/packages/pkg/dist/bin/generate.js": "#!/usr/bin/env node\n",
      "/repo/packages/pkg/dist/bin/serve.js": "#!/usr/bin/env node\n"
    });
    volume.chmodSync("/repo/packages/pkg/dist/bin/generate.js", 0o644);
    volume.chmodSync("/repo/packages/pkg/dist/bin/serve.js", 0o644);
    const fileSystem = createFsFromVolume(volume).promises;

    const changed = await setBinExecutable("/repo/packages/pkg", fileSystem);

    expect(changed).toEqual(["dist/bin/generate.js", "dist/bin/serve.js"]);
    expect(modeOf(volume, "/repo/packages/pkg/dist/bin/generate.js")).toBe(0o755);
    expect(modeOf(volume, "/repo/packages/pkg/dist/bin/serve.js")).toBe(0o755);
  });

  it("supports a string bin", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/pkg/package.json": JSON.stringify({ name: "pkg", bin: "dist/cli.js" }),
      "/repo/packages/pkg/dist/cli.js": "#!/usr/bin/env node\n"
    });
    volume.chmodSync("/repo/packages/pkg/dist/cli.js", 0o644);
    const fileSystem = createFsFromVolume(volume).promises;

    await setBinExecutable("/repo/packages/pkg", fileSystem);

    expect(modeOf(volume, "/repo/packages/pkg/dist/cli.js")).toBe(0o755);
  });

  it("throws naming the bin when its target file is missing", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/pkg/package.json": JSON.stringify({ bin: { "pkg-cli": "dist/cli.js" } })
    });
    const fileSystem = createFsFromVolume(volume).promises;

    await expect(setBinExecutable("/repo/packages/pkg", fileSystem)).rejects.toThrow(
      "dist/cli.js"
    );
  });

  it("is a no-op when no bin is declared", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/pkg/package.json": JSON.stringify({ name: "pkg" })
    });
    const fileSystem = createFsFromVolume(volume).promises;

    await expect(setBinExecutable("/repo/packages/pkg", fileSystem)).resolves.toEqual([]);
  });
});
