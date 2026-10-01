import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createBcCommand, settings } from "./index.js";

test("bc command definition exports standard contract", () => {
  const def = createBcCommand();
  assert.equal(def.name, "bc");
  assert.equal(typeof def.execute, "function");
});

test("bc resource quotas are optional with equivalent flat and nested options", () => {
  const defaults = settings();
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    assert.equal(settings({ [key]: undefined })[key], Infinity);
    assert.equal(settings({ limits: { [key]: undefined } })[key], Infinity);
    for (const value of [Infinity, 16]) {
      assert.equal(settings({ [key]: value })[key], value);
      assert.equal(settings({ limits: { [key]: value } })[key], value);
    }
    for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ [key]: value }), RangeError);
  }
});


test("bc evaluates exponents above the former implicit ceiling", async () => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { createBytePipe, createCommandArguments } = await import("safe-bash-contracts");
  const stdin = createBytePipe(), stdout = createBytePipe(), stderr = createBytePipe();
  await stdin.writable.write(new TextEncoder().encode("2^20000\nscale=5; 2^-10001\n"));
  await stdin.close();
  const result = await createBcCommand().execute({
    command: "bc", args: createCommandArguments([]).args, cwd: "/", env: { BC_LINE_LENGTH: "0" },
    fs: createMemoryFileSystem(), stdin: stdin.readable,
    stdout: stdout.writable, stderr: stderr.writable, signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stdout.readable) chunks.push(chunk);
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString("utf8"), `${2n ** 20000n}\n0\n`);
});

async function evaluate(
  program: string,
  options: Parameters<typeof createBcCommand>[0] = {},
  args: string[] = [],
  context: Partial<CommandContext> = {},
) {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { createBytePipe, createCommandArguments } = await import("safe-bash-contracts");
  const stdin = createBytePipe(), stdout = createBytePipe(), stderr = createBytePipe();
  await stdin.writable.write(new TextEncoder().encode(program));
  await stdin.close();
  const result = await createBcCommand(options).execute({
    command: "bc", args: createCommandArguments(args).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: stdin.readable,
    stdout: stdout.writable, stderr: stderr.writable, signal: new AbortController().signal,
    ...context,
  });
  await stdout.close();
  await stderr.close();
  const read = async (source: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  };
  return { exitCode: result.exitCode, stdout: await read(stdout.readable), stderr: await read(stderr.readable) };
}

test("bc rejects pre-aborted execution before input access or output", async (t) => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const fs = createMemoryFileSystem();
  const readFile = t.mock.method(fs, "readFile");
  const write = t.mock.fn(async () => {});
  const iterator = t.mock.fn(async function* () { yield new TextEncoder().encode("1+1"); });
  for (const reason of [undefined, new Error("cancelled"), { cancelled: true }]) {
    const controller = new AbortController();
    controller.abort(reason);
    for (const args of [[], ["--expression", "1+1"], ["program.bc"]]) {
      await assert.rejects(evaluate("", {}, args, {
        fs, stdin: { [Symbol.asyncIterator]: iterator },
        signal: controller.signal, stdout: { write }, stderr: { write },
      }), error => error === controller.signal.reason);
    }
  }
  assert.equal(iterator.mock.callCount(), 0);
  assert.equal(readFile.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});

test("bc propagates cancellation during stdin collection and closes the iterator", async (t) => {
  const controller = new AbortController();
  const reason = new Error("input cancelled");
  const write = t.mock.fn(async () => {});
  let closed = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      yield new TextEncoder().encode("1+");
      controller.abort(reason);
      yield new TextEncoder().encode("1");
    } finally { closed = true; }
  } };
  await assert.rejects(evaluate("", {}, [], {
    stdin, signal: controller.signal, stdout: { write }, stderr: { write },
  }), error => error === reason);
  assert.equal(closed, true);
  assert.equal(write.mock.callCount(), 0);
});

test("bc checks cancellation after reading a program file", async (t) => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("file read cancelled");
  t.mock.method(fs, "readFile", async () => {
    controller.abort(reason);
    return new TextEncoder().encode("1+1");
  });
  const write = t.mock.fn(async () => {});
  await assert.rejects(evaluate("", {}, ["program.bc"], {
    fs, signal: controller.signal, stdout: { write }, stderr: { write },
  }), error => error === reason);
  assert.equal(write.mock.callCount(), 0);
});

test("bc propagates cancellation at a cooperative execution yield", async (t) => {
  const controller = new AbortController();
  const reason = new Error("execution cancelled");
  const write = t.mock.fn(async () => {});
  const stdin = { async *[Symbol.asyncIterator]() {
    yield new TextEncoder().encode("while (1) { x++ }");
    const timer = setTimeout(() => controller.abort(reason), 0);
    t.after(() => clearTimeout(timer));
  } };
  await assert.rejects(evaluate("", { maxSteps: 20000 }, [], {
    stdin, signal: controller.signal, stdout: { write }, stderr: { write },
  }), error => error === reason);
  assert.equal(write.mock.callCount(), 0);
});

for (const destination of ["stdout", "stderr"] as const) {
  test(`bc propagates cancellation during ${destination} writes`, async (t) => {
    const controller = new AbortController();
    const reason = new Error("output cancelled");
    const write = t.mock.fn(async () => { controller.abort(reason); });
    const otherWrite = t.mock.fn(async () => {});
    await assert.rejects(evaluate(destination === "stdout" ? "1+1" : "1/0", {}, [], {
      signal: controller.signal,
      stdout: { write: destination === "stdout" ? write : otherWrite },
      stderr: { write: destination === "stderr" ? write : otherWrite },
    }), error => error === reason);
    assert.equal(write.mock.callCount(), 1);
    assert.equal(otherWrite.mock.callCount(), 0);
  });
}

for (const source of ["stdin", "stdout"] as const) {
  test(`bc propagates ${source} AbortError without a diagnostic`, async (t) => {
    const reason = new DOMException("I/O cancelled", "AbortError");
    const write = t.mock.fn(async () => {});
    const io: Partial<CommandContext> = source === "stdin"
      ? { stdin: { [Symbol.asyncIterator]() { throw reason; } } }
      : { stdout: { async write() { throw reason; } } };
    await assert.rejects(evaluate("1+1", {}, [], { ...io, stderr: { write } }), error => error === reason);
    assert.equal(write.mock.callCount(), 0);
  });
}

test("bc still reports ordinary usage and evaluation errors", async () => {
  assert.deepEqual(await evaluate("", {}, ["--invalid"]), {
    exitCode: 2, stdout: "", stderr: "bc: invalid option -- '-'\n",
  });
  assert.deepEqual(await evaluate("1/0"), {
    exitCode: 1, stdout: "", stderr: "bc: Runtime error (func=(main), adr=0): Divide by zero\n",
  });
});

for (const [program, stdout] of [
  ["123", "123\n"],
  ["print 123", "123"],
  ['"é🙂"', "é🙂"],
  ['print "é", "🙂"', "é🙂"],
  ['x="é"; x="🙂"', "é🙂"],
  ['1; print "é"; "🙂"', "1\né🙂"],
  ["obase=1001; 1002", " 0001 0001\n"],
  ['define f() { print "é"; return (1); }\nf(); halt; "unused"', "é1\n"],
] as const) {
  test(`bc enforces cumulative UTF-8 output bytes: ${program}`, async () => {
    const bytes = new TextEncoder().encode(stdout).byteLength;
    for (const nested of [false, true]) {
      const exact = nested ? { limits: { maxOutputBytes: bytes } } : { maxOutputBytes: bytes };
      const short = nested ? { limits: { maxOutputBytes: bytes - 1 } } : { maxOutputBytes: bytes - 1 };
      assert.deepEqual(await evaluate(program, exact), { exitCode: 0, stdout, stderr: "" });
      assert.deepEqual(await evaluate(program, short), {
        exitCode: 1, stdout: "", stderr: `bc: output exceeds maximum size (${bytes - 1} bytes)\n`,
      });
    }
  });
}

test("bc checks output quota before executing subsequent statements", async () => {
  assert.deepEqual(await evaluate('"ab"; 1/0', { maxOutputBytes: 100, limits: { maxOutputBytes: 1 } }), {
    exitCode: 1, stdout: "", stderr: "bc: output exceeds maximum size (1 bytes)\n",
  });
  for (const options of [{}, { maxOutputBytes: Infinity }, { limits: { maxOutputBytes: Infinity } }]) {
    assert.deepEqual(await evaluate('print "é🙂", 123', options), { exitCode: 0, stdout: "é🙂123", stderr: "" });
  }
});

for (const [program, expected] of [
  ["(++x) + sqrt(4); x", "3\n1\n"],
  ["x=0; x++ + sqrt(4); x", "2\n1\n"],
  ["x=0; ++x + a[0]; x", "1\n1\n"],
  ["x=1; (x+=10) + length(123); x", "14\n11\n"],
  ["scale=0; scale++ + sqrt(4); scale", "2.0\n1\n"],
  ["ibase=10; ibase-- + sqrt(4); ibase", "12\n9\n"],
  ["obase=10; obase-- + sqrt(4); obase", "13\n10\n"],
  ["1; last++ + sqrt(4)", "1\n3\n"],
  ["define f() { return (2); }\nx=0; x++ + f(); x", "2\n1\n"],
] as const) {
  test(`bc evaluates side effects once: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout: expected, stderr: "" });
  });
}

test("bc evaluates each mutation once across cooperative execution yields", async () => {
  const program = Array.from({ length: 1100 }, () => "(++x)+1").join(";") + ";x";
  const stdout = Array.from({ length: 1100 }, (_, index) => `${index + 2}\n`).join("") + "1100\n";
  assert.deepEqual(await evaluate(program), { exitCode: 0, stdout, stderr: "" });
});

for (const [program, expected] of [
  ["1.5^4", "5.0"],
  ["scale=2; 1.09^10", "2.36"],
  ["scale=3; 1.5^-4", ".197"],
  ["scale=3; .2^-4", "625.000"],
  ["scale=0; (-1.5)^3", "-3.3"],
  ["scale=8; 1.50^2", "2.2500"],
  ["scale=2; x=1.09; x^=10; x", "2.36"],
  ["scale=5; 0^0; 2^1.9", "1\n2"],
] as const) {
  test(`bc truncates powers only after exact exponentiation: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
  });
}

const recursion = "define f(n) { if (n == 0) return (0); return (1+f(n-1)); }\n";

test("bc recursion is unlimited by default and accepts explicit Infinity", async () => {
  for (const options of [{}, { limits: { maxRecursionDepth: Infinity } }]) {
    assert.deepEqual(await evaluate(recursion + "f(100)", options), { exitCode: 0, stdout: "100\n", stderr: "" });
  }
});

test("bc enforces configurable recursion depth at the frame boundary", async () => {
  assert.deepEqual(await evaluate(recursion + "f(3)", { maxRecursionDepth: 4 }), { exitCode: 0, stdout: "3\n", stderr: "" });
  const result = await evaluate(recursion + "f(4)", { limits: { maxRecursionDepth: 4 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "bc: bc function recursion depth exceeded (4)\n");
});

test("bc output bases are unlimited by default and accept explicit Infinity", async () => {
  assert.equal(settings().maxObase, Infinity);
  for (const options of [{}, { maxObase: Infinity }, { limits: { maxObase: Infinity } }]) {
    assert.deepEqual(await evaluate("obase=1001; obase; 1000; 1002; -1002; .1; 1.23; 0", options), {
      exitCode: 0, stderr: "",
      stdout: " 0001 0000\n 1000\n 0001 0001\n- 0001 0001\n.0100\n 0001.0230\n0\n",
    });
    assert.deepEqual(await evaluate("obase=9007199254740993; obase; 9007199254740992", options), {
      exitCode: 0, stderr: "",
      stdout: " 0000000000000001 0000000000000000\n 9007199254740992\n",
    });
  }
});

test("bc enforces configurable output base limits on assignments and increments", async () => {
  for (const options of [{ maxObase: 1001 }, { limits: { maxObase: 1001 } }]) {
    assert.deepEqual(await evaluate("obase=1001; 1002", options), { exitCode: 0, stdout: " 0001 0001\n", stderr: "" });
    for (const program of ["obase=1002", "obase=1001; obase++", "obase=1001; obase+=1"]) {
      const result = await evaluate(program, options);
      assert.equal(result.exitCode, 1, program);
      assert.equal(result.stderr, "bc: obase (1002) out of bounds [2, 1001]\n", program);
    }
  }
  assert.equal(settings({ maxObase: 1001, limits: { maxObase: 16 } }).maxObase, 16);
  assert.equal((await evaluate("obase=1")).exitCode, 1);
});

for (const [program, stdout] of [
  ["obase=2; 1.23", "1.0011101\n"],
  ["obase=16; 1.23", "1.3A\n"],
  ["obase=17; 1.23", " 01.03 15\n"],
  ["obase=100; 101; 1.2", " 01 01\n 01.20\n"],
] as const) {
  test(`bc formats output base digits and fractional precision: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout, stderr: "" });
  });
}

test("bc enforces exponent magnitude for powers and compound assignment", async () => {
  for (const expression of ["2^5", "2^-5", "x=2; x^=5", "x=2; x^=-5"]) {
    const result = await evaluate(expression, { limits: { maxExponent: 4 } });
    assert.equal(result.exitCode, 1, expression);
    assert.equal(result.stderr, "bc: exponent exceeds maximum limit (4)\n");
  }
  assert.deepEqual(await evaluate("2^4; scale=4; 2^-4", { maxExponent: 4 }), { exitCode: 0, stdout: "16\n.0625\n", stderr: "" });
  assert.equal((await evaluate("2^10001", { maxExponent: Infinity })).exitCode, 0);
});

for (const [program, stdout] of [
  ["A; F; AA; 1A; .A; A.A", "10\n15\n99\n19\n.9\n9.9\n"],
  ["ibase=8; A; F; AA; 1A; .A", "10\n15\n63\n15\n.8\n"],
  ["ibase=16; A; AA; A.A", "10\n170\n10.6\n"],
] as const) {
  test(`bc accepts hexadecimal digits: ${program}`, async () => {
    assert.deepEqual(await evaluate(program), { exitCode: 0, stdout, stderr: "" });
  });
}

test("bc math library preserves decimal precision at default and extended scales", async () => {
  const result = await evaluate("4*a(1); s(1); c(1); l(2); e(1); j(0,1); scale=40; a(1)\n", {}, ["-l"]);
  assert.deepEqual(result, { exitCode: 0, stderr: "", stdout: [
    "3.14159265358979323844", ".84147098480789650665", ".54030230586813971740",
    ".69314718055994530941", "2.71828182845904523536", ".76519768655796655144",
    ".7853981633974483096156608458198757210492", ""
  ].join("\n") });
});

for (const [expression, expected] of [
  ["s(1)", ".8414709848078965066525023216302989996225"],
  ["c(1)", ".5403023058681397174009366074429766037323"],
  ["l(2)", ".6931471805599453094172321214581765680755"],
  ["e(1)", "2.7182818284590452353602874713526624977572"],
  ["j(0,1)", ".7651976865579665514497175261026632209092"],
  ["j(-1,1)", "-.4400505857449335159596822037189149131273"],
  ["j(1,-1)", "-.4400505857449335159596822037189149131273"],
  ["s(0); a(0); l(1); j(1,0)", "0\n0\n0\n0"],
] as const) {
  test(`bc math at scale 40: ${expression}`, async () => {
    assert.deepEqual(await evaluate(`scale=40; ${expression}`, {}, ["-l"]), { exitCode: 0, stdout: expected + "\n", stderr: "" });
  });
}

test("bc Bessel iterations obey the work quota", async () => {
  const result = await evaluate("j(100,1)", { maxSteps: 10 }, ["-l"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /maximum step limit/);
});

test("bc concurrent math calls retain their own scale", async () => {
  const results = await Promise.all([evaluate("scale=3; a(1)", {}, ["-l"]), evaluate("a(1)", {}, ["-l"])]);
  assert.equal(results[0]?.stdout, ".785\n");
  assert.equal(results[1]?.stdout, ".78539816339744830961\n");
});

for (const [program, expected] of [
  ["define f(x) { auto a[]; a[0]=x; if(x>1) { g=f(x-1) }; return a[0] }; a[0]=99; f(2); a[0]\n", "2\n99\n"],
  ["define f(x) { auto a[], a; a=7; a[0]=x; return a+a[0] }; a=4; a[0]=99; f(2); a; a[0]\n", "9\n4\n99\n"],
]) {
  test(`bc scopes local arrays: ${program}`, async () => {
    assert.deepEqual(await evaluate(program!), { exitCode: 0, stdout: expected, stderr: "" });
  });
}

test("bc prints parenthesized assignments but suppresses bare assignments", async () => {
  assert.deepEqual(await evaluate("(x=5); x=6; ((x+=2)); x\n"), {
    exitCode: 0, stdout: "5\n8\n8\n", stderr: "",
  });
});

for (const [program, expected] of [
  ['x=1; (++x)+sqrt(4); x', '4\n2\n'],
  ['x=1; (x+=10)+a[0]; x', '11\n11\n'],
  ['define f() { return 2; }\nx=1; (++x)+f(); x', '4\n2\n'],
  ['scale=1; (++scale)+sqrt(4); scale', '4.00\n2\n'],
  ['ibase=2; (++ibase)+sqrt(4); ibase', '5\n3\n'],
  ['obase=2; (++obase)+sqrt(4); obase', '12\n10\n'],
  ['1; (++last)+sqrt(4); last', '1\n4\n4\n'],
  ['define f() { auto x; x=1; return (++x)+sqrt(4); }\nf()', '4\n'],
  ['x=0; for(i=0;i<5000;i++) y=(++x)+sqrt(4); x; y', '5000\n5002\n'],
]) test(`bc evaluates mutations once across complex expressions: ${program}`, async () => {
  assert.deepEqual(await evaluate(program + '\n'), { exitCode: 0, stdout: expected, stderr: '' });
});

test("bc wraps numeric output at the default width and honors BC_LINE_LENGTH", async () => {
  const digits = (2n ** 300n).toString();
  for (const [env, expected] of [
    [{}, digits.slice(0, 69) + "\\\n" + digits.slice(69)],
    [{ BC_LINE_LENGTH: "0" }, digits],
    [{ BC_LINE_LENGTH: "10" }, Array.from({ length: Math.ceil(digits.length / 9) }, (_, i) => digits.slice(i * 9, i * 9 + 9)).join("\\\n")],
  ] as const) {
    assert.deepEqual(await evaluate("2^300", {}, [], { env }), { exitCode: 0, stdout: expected + "\n", stderr: "" });
  }
});

for (const expression of ["s(1)", "c(1)", "a(1)", "l(2)", "e(1)", "2^10001"]) {
  test(`bc charges iterative arithmetic to maxSteps: ${expression}`, async () => {
    const result = await evaluate(expression, { maxSteps: 10 }, ["-l"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /maximum step limit/);
  });
}

test("bc supports precision beyond a precomputed pi table", async () => {
  const result = await evaluate("scale=1100; s(1)", {}, ["-l"], { env: { BC_LINE_LENGTH: "0" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 1102);
  assert.ok(result.stdout.startsWith(".8414709848078965066525023216302989996225"));
});

test("bc exponentials exceed floating point range and preserve nested truncation", async () => {
  const result = await evaluate("length(e(1000)); l(e(1))", {}, ["-l"]);
  assert.deepEqual(result, { exitCode: 0, stdout: "455\n.99999999999999999999\n", stderr: "" });
});

test("bc wraps print numbers across output columns and counts continuation bytes", async () => {
  const program = 'print "abc",123456789; print "\\n"; 1234567890';
  const stdout = 'abc123456\\\n789\n123456789\\\n0\n';
  assert.deepEqual(await evaluate(program, { maxOutputBytes: stdout.length }, [], { env: { BC_LINE_LENGTH: "10" } }), { exitCode: 0, stdout, stderr: "" });
  assert.equal((await evaluate(program, { maxOutputBytes: stdout.length - 1 }, [], { env: { BC_LINE_LENGTH: "10" } })).exitCode, 1);
  for (const value of ["1", "-1", "invalid", "1.5"]) {
    assert.equal((await evaluate("2^300", {}, [], { env: { BC_LINE_LENGTH: value } })).stdout, (await evaluate("2^300")).stdout);
  }
});

test("bc retains single digits in binary and resets ibase with A", async () => {
  assert.deepEqual(await evaluate("ibase=2; A; F; 9; 11; ibase=A; 19"), { exitCode: 0, stdout: "10\n15\n9\n3\n19\n", stderr: "" });
});

test("bc handles exponentially small results without allocating argument-sized precision", async () => {
  assert.deepEqual(await evaluate("e(-(10^310))", {}, ["-l"]), { exitCode: 0, stdout: "0\n", stderr: "" });
});

for (const expression of ["e(1000000000)", "j(0,1000000000)"]) {
  test(`bc checks the work budget before large precision allocation: ${expression}`, async () => {
    const result = await evaluate(expression, { maxSteps: 10 }, ["-l"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /maximum step limit/);
  });
}

for (const scale of [0, 20]) {
  test(`bc truncates tiny negative exponential arguments below one at scale ${scale}`, async () => {
    const program = `scale=${scale}; e(-.${"0".repeat(99)}1)`;
    assert.deepEqual(await evaluate(program, {}, ["-l"]), { exitCode: 0, stdout: scale === 0 ? "0\n" : "." + "9".repeat(scale) + "\n", stderr: "" });
  });
}

test("bc keeps small series corrections that affect final truncation", async () => {
  assert.deepEqual(await evaluate('scale=20; s(.00000000000000000001); a(.00000000000000000001); c(.00000000000000000001); j(0,.00000000000000000001)', {}, ['-l']), {
    exitCode: 0, stdout: '0\n0\n.99999999999999999999\n.99999999999999999999\n', stderr: '',
  });
});
