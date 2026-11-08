import { expect, it, vi } from "vitest";

vi.mock("../../src/interp/object-model.js", () => {
  throw new Error("Parent reporting must not import the guest runtime");
});
vi.mock("../../src/interp/values.js", () => {
  throw new Error("Parent reporting must not import the guest runtime");
});

it("loads report validation without loading the guest runtime", async () => {
  await expect(import("./report.js")).resolves.toHaveProperty("aggregateReports");
});

it("loads worker isolation without loading the guest runtime", async () => {
  await expect(import("./isolate.js")).resolves.toHaveProperty("createTest262Executor");
});
