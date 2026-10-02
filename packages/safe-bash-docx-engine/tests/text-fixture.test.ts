import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { readPackage, assertPackageLinks } from "./assertions.js";
import { nativeStoryFixture } from "./fixtures/native-parts.js";
import { textFixture } from "./fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`provisions the requested ${kind} package directly; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture("<w:p/>", {}, strict, { kind }));
  assertPackageLinks(parts);
  expect(new TextDecoder().decode(parts.get("[Content_Types].xml"))).toContain(
    `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`
  );
});

it.each([
  [false, "document.DocumentPart", "00b1c1256be3fbc18adb1a81a29787ecf1dfe572f3c3db865b6848f65773069b"],
  [false, "hdrftr.HeaderPart", "c77d9cc316c5f28cbc667117c971e64d0d08c48369022880138004697072f0db"],
  [true, "document.DocumentPart", "91b11d0f5dc0f396123ea7cdb073d08ea26d641b56bd9d834e3f08788a2c06db"],
  [true, "hdrftr.HeaderPart", "d2a2f15c8f2905c52da658160c488ec97e1b6ec145854023242c48766b135121"]
] as const)("retains the exact native template archive for strict=%s owner=%s", async (strict, owner, checksum) => {
  const { input } = await nativeStoryFixture(owner, strict, "dotx", "<w:p><w:r><w:t>Retained 海</w:t></w:r></w:p>");
  expect(createHash("sha256").update(input).digest("hex")).toBe(checksum);
});
