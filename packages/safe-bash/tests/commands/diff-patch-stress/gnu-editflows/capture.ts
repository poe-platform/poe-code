import { fixtures } from "./fixtures.js";
import { binary, binarySha256, digest, native, proof, type Evidence } from "./native.js";

const evidence: Evidence = { version: await proof(), binary, binarySha256, fixtureSha256: digest(JSON.stringify(fixtures)), cases: {} };
for (const fixture of fixtures) evidence.cases[fixture.name] = await native(fixture);
const output = JSON.stringify(evidence, null, 2) + "\n";
process.stdout.write("*** Begin Patch\n*** Add File: tests/commands/diff-patch-stress/gnu-editflows/native-evidence.json\n");
process.stdout.write(output.trimEnd().split("\n").map(line => `+${line}`).join("\n"));
process.stdout.write("\n*** End Patch\n");
