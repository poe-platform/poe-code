import { cases } from "./cases.js";
import { hash, hashes, native, product, save } from "./support.js";
const before = await hashes();
const expected = [];
const observed = [];
for (const fixture of cases) {
  const oracle = await native(fixture);
  const actual = await product(fixture);
  expected.push({ fixture, inputSha256: hash(JSON.stringify(fixture)), oracle });
  observed.push({ name: fixture.name, actual, match: actual.stdoutHex === oracle.stdoutHex && actual.exitCode === oracle.exitCode && Boolean(actual.stderrHex) === Boolean(oracle.stderrHex) && JSON.stringify(actual.files) === JSON.stringify(oracle.files) });
}
save("frozen-corpus.json", expected);
save("original-red.json", { before, after: await hashes(), nativeCalls: cases.length, productCases: cases.length, observed });
console.log(JSON.stringify({ total: cases.length, failures: observed.filter(row => !row.match) }, null, 2));
