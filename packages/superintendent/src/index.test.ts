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

  it("re-exports the testing helpers for external consumers", async () => {
    const pkg = await import("./index.js");

    expect(pkg).toMatchObject({
      createSuperintendentSimulation: expect.any(Function),
      successTurn: expect.any(Function),
      failTurn: expect.any(Function),
      builderTurn: expect.any(Function),
      inspectorTurn: expect.any(Function),
      superintendentTurn: expect.any(Function),
      ownerApproveTurn: expect.any(Function),
      ownerRejectTurn: expect.any(Function)
    });
  });
});
