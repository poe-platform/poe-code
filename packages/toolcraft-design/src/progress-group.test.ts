import { expect, it } from "vitest";
import { renderProgressGroup } from "./progress-group.js";

it("renders truthful bounded progress", () => {
  expect(renderProgressGroup([{ label: "Upload", completed: 2, total: 4 }, { label: "Wait" }], 30).join("\n")).toContain("50%");
  expect(renderProgressGroup([{ label: "Wait" }], 30)[0]).toContain("…");
});
it("keeps progress labels on one safe terminal row", () => {
  expect(renderProgressGroup([{ label: "First\nSecond\x1b[2J" }], 40)).toEqual(["● First Second …"]);
});
