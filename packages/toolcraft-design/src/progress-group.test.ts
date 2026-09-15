import { expect, it } from "vitest";
import { renderProgressGroup } from "./progress-group.js";

it("renders truthful bounded progress", () => {
  expect(renderProgressGroup([{ label: "Upload", completed: 2, total: 4 }, { label: "Wait" }], 30).join("\n")).toContain("50%");
  expect(renderProgressGroup([{ label: "Wait" }], 30)[0]).toContain("…");
});