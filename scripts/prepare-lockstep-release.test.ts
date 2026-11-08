import { describe, expect, it } from "vitest";
import { prepareLockstepRelease } from "./prepare-lockstep-release.mjs";

describe("prepareLockstepRelease", () => {
  it("sets every package version and exact intra-group dependency range", () => {
    const manifests = new Map([
      [
        "packages/a",
        {
          name: "a",
          version: "0.0.1",
          dependencies: { b: "*", external: "^1.0.0" },
          optionalDependencies: { c: "workspace:*" }
        }
      ],
      ["packages/b", { name: "b", version: "0.0.2", peerDependencies: { a: "*" } }],
      ["packages/c", { name: "c", version: "0.0.3" }]
    ]);

    prepareLockstepRelease(manifests, "1.2.3");

    expect(manifests.get("packages/a")).toMatchObject({
      version: "1.2.3",
      dependencies: { b: "1.2.3", external: "^1.0.0" },
      optionalDependencies: { c: "1.2.3" }
    });
    expect(manifests.get("packages/b")).toMatchObject({
      version: "1.2.3",
      peerDependencies: { a: "1.2.3" }
    });
    expect(manifests.get("packages/c")).toMatchObject({ version: "1.2.3" });
  });

  it("rejects duplicate package names", () => {
    const manifests = new Map([
      ["packages/a", { name: "same", version: "0.0.1" }],
      ["packages/b", { name: "same", version: "0.0.2" }]
    ]);

    expect(() => prepareLockstepRelease(manifests, "1.2.3")).toThrow("Duplicate package name");
  });
});
