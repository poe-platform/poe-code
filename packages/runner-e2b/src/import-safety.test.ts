import { describe, expect, it, vi } from "vitest";

const { e2bLoad } = vi.hoisted(() => ({
  e2bLoad: vi.fn(() => {
    throw new Error("e2b SDK should load lazily");
  })
}));

vi.mock("e2b", e2bLoad);

describe("runner-e2b import safety", () => {
  it("does not load the e2b SDK when importing the factory", async () => {
    await expect(import("./factory.js")).resolves.toMatchObject({
      e2bExecutionEnvFactory: expect.objectContaining({ type: "e2b" })
    });
    expect(e2bLoad).not.toHaveBeenCalled();
  });
});
