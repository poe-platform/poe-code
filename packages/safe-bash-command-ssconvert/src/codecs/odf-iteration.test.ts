import { expect, it } from "vitest";
import { content, context, fixture } from "./odf.test.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { unpackOdf } from "./odf-write.test.js";

async function input(attributes: string) {
  return fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet",
    "content.xml": content('<table:calculation-settings table:automatic-find-labels="false">' +
      `<table:iteration ${attributes}/></table:calculation-settings><table:table table:name="S"/>`) });
}

it.each([
  ["enable", 'table:steps="25"', 25],
  ["disable", 'table:steps="7"', 7],
  ["enable", 'table:steps="0"', 0],
  ["enable", 'table:steps="65535"', 65535],
  ["enable", "", 100],
  ["disable", 'xmlns:foreign="urn:foreign" foreign:steps="9"', 100]
] as const)("retains %s iteration count %s across both ODF profiles", async (status, steps, maximum) => {
  // Calc XMLCalculationSettingsContext reads TABLE:STEPS; 100 is only the default.
  const bytes = await input(`table:status="${status}" ${steps} table:maximum-difference="0.01"`);
  const original = bytes.slice();
  const book = await readOdf(bytes, context);
  const expected = { enabled: status === "enable", maximum, tolerance: 0.01 };
  expect(book.iteration).toEqual(expected);
  for (const profile of ["strict", "extended"] as const) {
    const output = await createOdfWriter(profile)(book, [], context);
    expect((await unpackOdf(output)).parts.get("content.xml")).toContain(`table:steps="${maximum}"`);
    expect((await readOdf(output, context)).iteration).toEqual(expected);
  }
  expect(bytes).toEqual(original);
});

it.each(["-1", "2.5", "NaN", "Infinity", "9007199254740992"])("rejects invalid iteration count %s", async steps => {
  await expect(readOdf(await input(`table:steps="${steps}"`), context))
    .rejects.toMatchObject({ code: "io", message: "E Invalid OpenDocument: invalid iteration count" });
});
