import { beforeEach, describe, expect, it, vi } from "vitest";

const { builderGroupMock, inspectorGroupMock, superintendentGroupMock } = vi.hoisted(() => ({
  builderGroupMock: { name: "builder" },
  inspectorGroupMock: { name: "inspector" },
  superintendentGroupMock: { name: "superintendent" }
}));

vi.mock("./commands/index.js", () => ({
  builderGroup: builderGroupMock,
  inspectorGroup: inspectorGroupMock,
  superintendentGroup: superintendentGroupMock
}));

describe("@poe-code/superintendent package exports", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("re-exports the command groups for SDK consumers", async () => {
    const pkg = await import("./index.js");

    expect(pkg.builderGroup).toBe(builderGroupMock);
    expect(pkg.inspectorGroup).toBe(inspectorGroupMock);
    expect(pkg.superintendentGroup).toBe(superintendentGroupMock);
  });
});
