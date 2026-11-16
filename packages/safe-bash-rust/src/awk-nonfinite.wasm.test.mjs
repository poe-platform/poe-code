import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const cases = [
  ["int input", "printf '1.5e309\\n-1.5e309\\n' | awk '{print int($1)}'", "inf\n-inf\n"],
  ["math", `awk 'BEGIN {print sqrt(-1), log(0), log(-1), exp(1000)}'`, "nan -inf nan inf\n"],
  ["nested math", `awk 'BEGIN {x=exp(1000); print int(x), log(x), sin(x), cos(x), int(sqrt(-1))}'`, "inf inf nan nan nan\n"],
  ["concatenation", `awk 'BEGIN {x=exp(1000); print "value=" x, "value=" sqrt(-1)}'`, "value=inf value=nan\n"],
  ["float flags", `awk 'BEGIN {printf "%#f|%010f|%+g|%G|%.101g\\n", exp(1000), exp(1000), sqrt(-1), log(0), exp(1000)}'`, "inf|       inf|nan|-INF|inf\n"],
  ["signs and padding", `awk 'BEGIN {printf "%+08F|% 08e|%-8G!\\n", exp(1000), exp(1000), sqrt(-1)}'`, "    +INF|     inf|NAN     !\n"],
  ["string formatting", `awk 'BEGIN {printf "%s|%.2s|%8s\\n", exp(1000), log(0), sqrt(-1)}'`, "inf|-i|     nan\n"],
  ["format variables", `awk 'BEGIN {OFMT="%+G"; CONVFMT="%E"; x=exp(1000); print x, "value=" x}'`, "+INF value=INF\n"],
  ["field spelling", "printf '1.5e309\\n' | awk '{print $1, int($1)}'", "1.5e309 inf\n"],
  ["finite controls", `awk 'BEGIN {printf "%.1f|%.0e|%.6g\\n", 1.25, 2.5, 999999.5; print int(-1.9), sqrt(4)}'`, "1.3|3e+00|1e+06\n-1 2\n"],
  ...["d", "i", "u", "o", "x", "X"].map(format => [
    `nonfinite %${format}`, `awk 'BEGIN {print "before"; printf "%${format}", "1e999"; print "after"}'`,
    "before\n", 2, "awk: cannot format a non-finite number\n",
  ]),
  ["arithmetic overflow", `awk 'BEGIN {print "before"; print 1e308*1e308}'`, "before\n", 2, "awk: non-finite arithmetic result\n"],
  ["division by zero", `awk 'BEGIN {print "before"; print 1/0}'`, "before\n", 2, "awk: division by zero\n"],
];
for (const mode of ["substitution", "loop", "arithmetic-loop"]) {
  const pipeline = "printf '1.5e309\\n' | awk '{print int($1)}'";
  const source = mode === "substitution" ? `out=$(${pipeline})`
    : mode === "loop" ? `for i in 1 2; do out=$(${pipeline}); done`
    : `for ((i=0;i<2;i++)); do out=$(${pipeline}); done`;
  cases.push([mode, `${source}; printf '%s\\n' "$out"`, "inf\n"]);
}
for (const runtime of ["TypeScript", "Rust"]) for (const [name, source, stdout, status = 0, stderr = ""] of cases) {
  test(`${runtime} awk nonfinite ${name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec(source);
      assert.deepEqual({status: result.exitCode, stdout: result.stdout, stderr: result.stderr}, {status, stdout, stderr});
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
