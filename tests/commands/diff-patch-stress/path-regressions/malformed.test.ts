import test from "node:test";
import { explicitTargetOnlyUpdate, rejectsWithoutMutation, section } from "./helpers.js";

const malformed = [
  '"a/target" garbage', '"a/target" ', '"a/target"/suffix', '"a/target""',
  '"a/target', '"a/target\\', '"a/target\\0"', '"a/target\\00"',
  '"a/target\\08"', '"a/target\\008"', '"a/target\\378"', '"a/target\\401"',
  '"a/target\\x41"', '"a/target\\u0041"', '"a/target\\U00000041"', '"a/target\\/"',
  '"a/\\200"', '"a/\\301\\251"', '"a/\\302"', '"a/\\342\\202"',
  '"a/\\355\\240\\200"', '"a/\\360\\200\\200\\257"', '"a/\\364\\220\\200\\200"',
  '"a/\\365\\200\\200\\200"', '"a/\\303x"',
  '"\\057sandbox/work/target"', '"\\057\\057target"', '"a/\\056\\056/target"',
  '"a//\\056./target"', '"a/dir/.\\056/target"', '"a/\\103\\072target"',
  '"a/dir/\\172:target"', '"a/\\134target"', '"a/dir\\134target"',
  '"a/target\\177"', '"a/target\\001"', '"a/target\\a"', '"a/target\\b"',
  '"a/target\\v"', '"a/target\\f"', '"a/target\\000tail"',
  '"a/target\\012tail"', '"a/target\\015tail"',
  "a/../target", "a//../target", "a/dir/../../target", "a/Z:target", "a/dir/c:target",
  "a/dir\\target", "a/target\u007f", "a/target\u0001",
];

for (const encoded of malformed) {
  for (const placement of ["old", "new", "explicit-old", "explicit-new"] as const) {
    const explicitAbsolute = placement.startsWith("explicit-")
      && ['"\\057sandbox/work/target"', '"\\057\\057target"'].includes(encoded);
    test(`${explicitAbsolute ? "explicit target overrides absolute header" : "unsafe/malformed"} ${placement} ${JSON.stringify(encoded)}`, { timeout: 3000 }, async () => {
      const newHeader = placement === "new" || placement === "explicit-new";
      const explicit = placement.startsWith("explicit-");
      const input = section(newHeader ? "a/target" : encoded, newHeader ? encoded : "a/target");
      if (explicitAbsolute) {
        await explicitTargetOnlyUpdate(input);
        return;
      }
      await rejectsWithoutMutation(explicit ? input : section("a/first") + input,
        explicit ? ["-p1", "target"] : ["-p1"]);
    });
  }
}

for (const invalid of [[0x80], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff], [0]]) {
  test(`raw invalid header bytes ${Buffer.from(invalid).toString("hex")}`, async () => {
    const input = Buffer.concat([
      Buffer.from(`${section("first")}--- "target`), Buffer.from(invalid),
      Buffer.from('"\n+++ "target"\n@@ -1 +1 @@\n-old\n+new\n'),
    ]);
    await rejectsWithoutMutation(input);
  });
}

for (const suffix of ['--- "target"\n', '--- "target"\n+++ "target', '--- "target"\n+++ "target"\n',
  '--- "target"\n+++ "target"\n@@ -1 +1 @@\n-old\n',
  '--- "target"\n+++ "target"\n@@ -1 +1 @@\n-old\n+new']) {
  test(`atomic extension later section truncation ${JSON.stringify(suffix)}`, async () => {
    await rejectsWithoutMutation(section("first") + suffix, ["--atomic"]);
  });
}
