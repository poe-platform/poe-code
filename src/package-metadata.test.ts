import { describe, expect, it, vi } from "vitest";

const manifest = vi.hoisted(() => vi.fn(() => ({ version: "99.8.7" })));
vi.mock("node:module", () => ({ createRequire: () => manifest }));

describe("runtime package metadata", () => {
  it("loads the installed manifest version instead of a build-time JSON constant", async () => {
    const { packageVersion } = await import("./package-metadata.js");
    expect(packageVersion).toBe("99.8.7");
    expect(manifest).toHaveBeenCalledWith("../package.json");
  });
});
