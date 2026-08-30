import test from "node:test";
import { compare, native, virtual, type Probe } from "./harness.js";

const files = {
  "src/a.ts": "TODO first\nexport const alpha = 1;\nTODO second\n",
  "src/space name.ts": "export const beta = 2;\nTODO third\n",
  "src/not-code.md": "TODO document\n", ".ignore": "*.md\n", "input": "éfoo foo\nother\nfoo\n",
};
const scripts = [
  "rg -n TODO src | cut -d: -f1 | sort -u | tee report",
  "rg -l0 TODO src | xargs -0 cat | rg -n TODO",
  "rg --files -g '*.ts' src | sort | rg 'space|a.ts'",
  "cat input | rg -nbo foo | cut -d: -f1 | sort -u",
  "rg -q MISSING src || printf 'clean\\n'",
  "rg -c TODO src | sort",
  "rg --json TODO src | rg -c '\"type\":\"match\"'",
  "printf 'foo\\nother\\nfoo\\n' | rg -m1 -A2 -n foo",
  "printf '' | rg foo -; printf '%s\\n' $?",
  "printf 'foo\\n' | rg foo | rg -q foo && printf 'found\\n'",
];
const probes: Probe[] = scripts.map(script => ({ name: script, args: [], files, script }));
const actual = virtual(probes);
for (const [index, probe] of probes.entries()) test(`pipeline ${probe.name}`, () => compare(actual[index]!, native(probe), probe));
