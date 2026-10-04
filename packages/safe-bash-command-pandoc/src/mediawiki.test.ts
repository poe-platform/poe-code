import {expect, it} from "vitest";
import {convert} from "./engine.js";

it("makes progress on an empty MediaWiki heading marker", async () => {
  const input = {bytes: new TextEncoder().encode("==\n")};
  await expect(convert([input], {from: "mediawiki", to: "plain"}, {limits: {work: 1000}})).resolves.toMatchObject({text: "==\n"});
});
