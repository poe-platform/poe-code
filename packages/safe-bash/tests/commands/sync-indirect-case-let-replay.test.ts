import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  { name: "scalar negative subscript", setup: "x=hello", values: "0 -1", reference: "x[$idx]", expected: "1:hello\n2:hello\n" },
  { name: "array out-of-bounds negative subscript", setup: "arr=(a b)", values: "0 -5", reference: "arr[$idx]", expected: "1:a\n2:\n" },
  { name: "arithmetic subscript", setup: "arr=(a b c)", values: "0 0+1", reference: "arr[$idx]", expected: "1:a\n2:b\n" },
  { name: "nameref element", setup: "arr=(a b c); declare -n ref=arr", values: "0 1", reference: "ref[$idx]", expected: "1:a\n2:b\n" },
  { name: "variable arithmetic subscript", setup: "arr=(a b c); i=0", values: "0 i+1", reference: "arr[$idx]", expected: "1:a\n2:b\n" },
  { name: "complex arithmetic subscript", setup: "arr=(a b c)", values: "0 (1+1)", reference: "arr[$idx]", expected: "1:a\n2:c\n" },
] as const;

for (const entry of cases) for (const loop of ["for", "while", "arithmetic for"] as const) {
  test(`indirect ${entry.name} executes each ${loop} iteration once`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const body = `cnt=$((cnt+1)); p="${entry.reference}"; echo "$cnt:\${!p}"`;
      const values = entry.values.split(" ");
      const script = loop === "for" ? `for idx in ${values.map(value => `'${value}'`).join(" ")}; do ${body}; done`
        : loop === "while" ? `n=0; while ((n<2)); do if ((n==0)); then idx='${values[0]}'; else idx='${values[1]}'; fi; ${body}; n=$((n+1)); done`
        : `for ((n=0;n<2;n++)); do if ((n==0)); then idx='${values[0]}'; else idx='${values[1]}'; fi; ${body}; done`;
      const result = await shell.exec(`${entry.setup}; cnt=0; ${script}; echo "final_cnt=$cnt"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `${entry.expected}final_cnt=2\n`);
    } finally { await shell.dispose(); }
  });
}

for (const entry of [
  { name: "indirect positional zero in set", source: 'set -- first; cnt=0; for p in 1 0; do cnt=$((cnt+1)); set -- "${!p}"; done; echo "cnt=$cnt arg1=$1"', expected: "cnt=2 arg1=virtual-bash\n" },
  { name: "indirect positional zero in echo", source: 'set -- first; cnt=0; for p in 1 0; do cnt=$((cnt+1)); echo "$cnt:${!p}"; done; echo "cnt=$cnt"', expected: "1:first\n2:virtual-bash\ncnt=2\n" },
  { name: "case retesting a mutated pattern", source: 'pat=nomatch; cnt=0; case hit in hit) cnt=$((cnt+1)); pat="[bad" ;;& $pat) cnt=$((cnt+10)) ;; esac; echo "cnt=$cnt"', expected: "cnt=1\n" },
  { name: "case retesting inside a loop", source: 'pat=nomatch; cnt=0; for i in 1 2; do case hit in hit) cnt=$((cnt+1)); pat="[bad" ;;& $pat) cnt=$((cnt+10)) ;; esac; done; echo "cnt=$cnt"', expected: "cnt=2\n" },
  { name: "case retesting a newly matching pattern", source: 'pat=nomatch; cnt=0; case hit in hit) cnt=$((cnt+1)); pat=hit ;;& $pat) cnt=$((cnt+10)) ;; esac; echo "cnt=$cnt"', expected: "cnt=11\n" },
  { name: "let division fault", source: 'cnt=0; for d in 2 0; do cnt=$((cnt+1)); let "r = 10 / $d" || true; done; echo "cnt=$cnt r=$r"', expected: "cnt=2 r=5\n" },
  { name: "let remainder fault after option terminator", source: 'cnt=0; for d in 3 0; do cnt=$((cnt+1)); let -- "r = 10 % $d" || true; done; echo "cnt=$cnt r=$r"', expected: "cnt=2 r=1\n" },
  { name: "let fault in a later argument", source: 'cnt=0; for d in 2 0; do cnt=$((cnt+1)); let "a+=1" "r = 10 / $d" || true; done; echo "cnt=$cnt a=$a r=$r"', expected: "cnt=2 a=2 r=5\n" },
  { name: "quoted let shifts and exponentiation", source: 'cnt=0; for d in 1 2; do cnt=$((cnt+1)); let "a = 8 << $d" "b = 8 >> $d" "r = 2 ** $d"; done; echo "cnt=$cnt a=$a b=$b r=$r"', expected: "cnt=2 a=32 b=2 r=4\n" },
]) {
  test(`${entry.name} does not replay effects`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(entry.source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, entry.expected);
    } finally { await shell.dispose(); }
  });
}
