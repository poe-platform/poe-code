import test from "node:test";
import { assertDefaultParity } from "../gnu-target-followup/evidence.js";
import { metadataProbes } from "../gnu-target-followup/fixtures.js";
import { exactUpdate, quoted, rejectsWithoutMutation, section } from "./helpers.js";

const preamble = "From 0123456789012345678901234567890123456789 Mon Sep 17 00:00:00 2001\n"
  + "From: Path Verifier <verifier@example.invalid>\nSubject: [PATCH] quoted filename\n\n"
  + "Change one literal path.\n---\n file | 2 +-\n\n";

test("mail with safely quoted Unicode/tab target and signature really applies", async () => {
  const name = 'mail-漢字\t"literal".txt';
  const oldPath = quoted(`a/${name}`);
  const newPath = quoted(`b/${name}`);
  await exactUpdate(name, preamble + `diff --git ${oldPath} ${newPath}\n`
    + section(oldPath, newPath) + "-- \n2.50.1\n", ["-p1"]);
});

const laterSections = [
  section('"a/\\056\\056/sentinel"'),
  section('"\\057sandbox/sentinel"'),
  '--- "a/target"\n',
  '--- "a/target"\n+++ "a/target"\n@@ -1 +1 @@\n-old\n',
  'diff --git "a/target" "b/target"\n',
  'index 0123456..1234567 100644\n',
];

for (const [index, suffix] of laterSections.entries()) {
  for (const boundary of ["after-patch", "after-signature"] as const) {
    test(`${index >= 2 ? "atomic extension " : ""}mail cannot conceal later section ${index} ${boundary}`, async () => {
      await rejectsWithoutMutation(preamble + section("a/first")
        + (boundary === "after-signature" ? "-- \n2.50.1\n" : "") + suffix, [...(index >= 2 ? ["--atomic"] : []), "-p1"]);
    });
  }
}

for (const metadata of [
  "rename from target", "rename to sentinel", "copy from target", "copy to sentinel",
  "new file mode 120000", "deleted file mode 120000", "old mode 120000", "new mode 120000",
  "similarity index 100%", "dissimilarity index 100%", "GIT binary patch", "unknown extension metadata",
]) {
  for (const position of ["between-sections", "after-signature"] as const) {
    if (metadata === "unknown extension metadata" && position === "after-signature") continue;
    test(position === "between-sections" ? `GNU default accepts interstitial metadata: ${metadata}` : `unsupported metadata cannot disappear ${position}: ${metadata}`, async () => {
      if (position === "between-sections") {
        const probe = metadataProbes.find(item => item.id === `metadata between-sections: ${metadata}`)!;
        await assertDefaultParity(probe);
        return;
      }
      const first = preamble + section("a/first");
      const suffix = `-- \n2.50.1\n${metadata}\n`;
      await rejectsWithoutMutation(first + suffix, ["-p1"]);
    });
  }
}

for (const metadata of ["new file mode 120000", "deleted file mode 120000"]) {
  test(`mail preamble must not discard symlink metadata: ${metadata}`, async () => {
    await rejectsWithoutMutation(preamble + `${metadata}\n` + section("a/first"), ["-p1"]);
  });
}
