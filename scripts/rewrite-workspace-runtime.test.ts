import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { rewriteWorkspaceRuntime } from "./rewrite-workspace-runtime.mjs";

describe("shipped workspace runtime imports", () => {
  it("resolves imports and re-exports to shipped files without changing strings or unrelated dependencies", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/shell/dist/nested/codec.js":
        'import { read } from "@local/codec/zip";\nexport { crc } from "@local/codec/zip";\nconst label = "@local/codec/zip";\nimport "pako";\n',
      "/repo/packages/codec/dist/zip.js": "export const read = 1;",
      "/repo/packages/shell/dist/types.d.ts": 'export * from "@local/codec/zip";'
    });
    await rewriteWorkspaceRuntime(
      "/repo/packages/shell/dist",
      {
        "@local/codec/zip": "/repo/packages/codec/dist/zip.js"
      },
      volume.promises
    );
    expect(volume.readFileSync("/repo/packages/shell/dist/nested/codec.js", "utf8")).toBe(
      'import { read } from "../../../codec/dist/zip.js";\nexport { crc } from "../../../codec/dist/zip.js";\nconst label = "@local/codec/zip";\nimport "pako";\n'
    );
    expect(volume.readFileSync("/repo/packages/shell/dist/types.d.ts", "utf8")).toBe(
      'export * from "@local/codec/zip";'
    );
  });
});
