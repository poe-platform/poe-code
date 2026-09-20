import {expect, it} from "vitest";
import {renderPdf, suppliedDefaultFont, type Placement} from "./index.js";

it("uses explicit line-height multipliers for original text placement", async () => {
  const boxes: Placement[] = [];
  await renderPdf({fonts: [suppliedDefaultFont()], lineHeight: 2, blocks: [{kind: "paragraph", runs: [{text: "first\nsecond", size: 18}]}]}, {yield: async () => {}, onPlacement: box => boxes.push(box)});
  expect(boxes[1]!.y - boxes[0]!.y).toBe(36);
});
it("rejects invalid line-height before font acquisition", async () => {
  await expect(renderPdf({fonts: [], lineHeight: 4, blocks: []})).rejects.toMatchObject({code: "E_CAPABILITY", message: "Invalid line-height multiplier"});
});
