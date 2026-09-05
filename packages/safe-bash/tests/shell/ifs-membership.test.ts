import assert from "node:assert/strict";
import { test } from "node:test";
import { getCommandArguments } from "../../src/contracts/command.js";
import { ShellLimitError, type ShellLimits } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

interface Control {
  ifs?: string;
  value?: string;
  bytes?: Uint8Array;
  script?: string;
  locale?: string;
  limits?: ShellLimits;
  signal?: AbortSignal;
}

async function inspect(control: Control) {
  const { shell, commands } = setup({ env: {
    ...(control.ifs === undefined ? {} : { IFS: control.ifs }),
    value: control.value ?? "",
    LC_ALL: control.locale ?? "C",
  } });
  const calls: { text: string[]; bytes: number[][] }[] = [];
  commands.register({ name: "inspect", execute(context) {
    const values = getCommandArguments(context);
    calls.push({ text: [...context.args], bytes: context.args.map((_value, index) => [...values.bytes(index)!]) });
    return { exitCode: 0 };
  } });
  if (control.bytes) commands.register({ name: "emit", async execute({ stdout }) {
    await stdout.write(control.bytes!);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(control.script ?? (control.bytes ? "value=$(emit); inspect $value" : "inspect $value"), {
      ...(control.limits ? { limits: control.limits } : {}),
      ...(control.signal ? { signal: control.signal } : {}),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    return calls;
  } finally { await shell.dispose(); }
}

async function searchWork(ifs: string, action: () => Promise<void>): Promise<number> {
  const descriptor = Object.getOwnPropertyDescriptor(String.prototype, "includes")!;
  let submittedUnits = 0;
  Object.defineProperty(String.prototype, "includes", { ...descriptor, value: function(this: string, ...args: Parameters<string["includes"]>) {
    if (this === ifs && args[0] !== "\0") submittedUnits += this.length;
    return Reflect.apply(descriptor.value, this, args);
  } });
  try { await action(); return submittedUnits; }
  finally { Object.defineProperty(String.prototype, "includes", descriptor); }
}

for (const ifs of ["x".repeat(16), "0123456789ABCDEF"]) {
  for (const length of [8, 16]) {
    for (const raw of [false, true]) {
      test(`IFS searches do not grow per input character: distinct=${ifs[0] === "0"}, length=${length}, raw=${raw}`, async context => {
        const value = "a".repeat(length);
        const work = await searchWork(ifs, async () => {
          const calls = await inspect({ ifs, ...(raw ? { bytes: Uint8Array.of(255, ...new TextEncoder().encode(value)) } : { value }) });
          assert.deepEqual(calls[0]!.text, [raw ? `�${value}` : value]);
        });
        context.diagnostic(`IFS search haystack units submitted: ${work}`);
        assert.ok(work <= ifs.length * 2, `bounded IFS preparation must replace per-character searches; submitted ${work} code units`);
      });
    }
  }
}

for (const length of [8, 16]) {
  test(`field classification does not rescan IFS per separator: ${length} fields`, async context => {
    const ifs = "0123456789ABCDEF";
    const work = await searchWork(ifs, async () => {
      const calls = await inspect({ ifs, value: "0".repeat(length) });
      assert.deepEqual(calls[0]!.text, Array<string>(length).fill(""));
    });
    context.diagnostic(`IFS search haystack units submitted: ${work}`);
    assert.ok(work <= ifs.length * 2, `field classification submitted ${work} IFS code units`);
  });
}

for (const [name, control, expected] of [
  ["default whitespace", { value: " \ta \n b\t " }, ["a", "b"]],
  ["nonwhitespace endpoints and repeats", { ifs: ":", value: ":a::b:" }, ["", "a", "", "b"]],
  ["duplicate nonwhitespace", { ifs: "::::", value: ":a::b:" }, ["", "a", "", "b"]],
  ["mixed whitespace and colon", { ifs: " :\t\n", value: " \ta : :b: " }, ["a", "", "b"]],
  ["duplicate whitespace", { ifs: "  \t\t\n\n", value: " \ta \n b\t " }, ["a", "b"]],
  ["empty IFS", { ifs: "", value: " a b " }, [" a b "]],
  ["empty unquoted value", { ifs: "", value: "" }, []],
  ["empty quoted value", { ifs: "", value: "", script: 'inspect "$value"' }, [""]],
  ["BMP separator", { ifs: "é", value: "cafééx" }, ["caf", "", "x"]],
  ["astral separator", { ifs: "🙂", value: "a🙂🙂b" }, ["a", "", "b"]],
  ["multiple separator scalars", { ifs: "ab", value: "1ab2ba3" }, ["1", "", "2", "", "3"]],
  ["no Unicode normalization", { ifs: "é", value: "ae\u0301b" }, ["ae\u0301b"]],
  ["NBSP is nonwhitespace", { ifs: "\u00a0", value: "\u00a0a\u00a0\u00a0b\u00a0" }, ["", "a", "", "b"]],
  ["CR is nonwhitespace", { ifs: "\r", value: "\ra\r\rb" }, ["", "a", "", "b"]],
  ["IFS mutation between words", { ifs: ":", value: "a:b", script: 'inspect $value; IFS=b; inspect $value' }, ["a:"]],
  ["IFS assignment during a word", { ifs: "", value: "a:b", script: 'inspect ${IFS:=:}$value' }, ["", "a", "b"]],
] satisfies [string, Control, string[]][]) {
  test(`IFS semantics: ${name}`, async () => {
    const calls = await inspect(control);
    assert.deepEqual(calls.at(-1)!.text, expected);
  });
}

test("single-character membership retains UTF-16 substring semantics, including isolated surrogates", async () => {
  for (const ifs of ["🙂", "\ud83d", "\ude42", "\ud83dX\ude42", "é", "\u0301"]) {
    for (const value of ["🙂", "\ud83d", "\ude42", "é", "\u0301", "x"]) {
      const calls = await inspect({ ifs, value });
      assert.deepEqual(calls[0]!.text, ifs.includes(value) ? [""] : [value], JSON.stringify({ ifs, value }));
    }
  }
});

for (const locale of ["C", "POSIX", "en_US.UTF-8"]) {
  for (const ifs of [" ", "é", "", "�"]) {
    test(`raw IFS semantics: locale=${locale}, IFS=${JSON.stringify(ifs)}`, async () => {
      const calls = await inspect({ ifs, bytes: Uint8Array.of(255, 32, 195, 169, 65), locale });
      const expected = ifs === " " ? [[255], [195, 169, 65]] : ifs === "é" ? [[239, 191, 189, 32], [65]] : ifs === "�" ? [[], [32, 195, 169, 65]] : [[255, 32, 195, 169, 65]];
      assert.deepEqual(calls[0]!.bytes, expected);
    });
  }
}

test("distinct IFS lookup storage is admitted against the expansion arena", async () => {
  await assert.rejects(inspect({ ifs: "0123456789ABCDEF", value: "a", limits: { maxExpansionBytes: 512 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
});

test("duplicate IFS storage is bounded and released between scalar words", async () => {
  const calls = await inspect({ ifs: "x".repeat(1024), value: "a", script: Array<string>(8).fill("inspect $value").join("; "), limits: { maxExpansionBytes: 512 } });
  assert.equal(calls.length, 8);
  for (const call of calls) assert.deepEqual(call.text, ["a"]);
});

test("lookup storage is released between array-owned words", async () => {
  const calls = await inspect({ ifs: "0123456789ABCDEF", script: `items=(a); ${Array<string>(8).fill("inspect ${items[0]}").join("; ")}`, limits: { maxExpansionBytes: 2048 } });
  assert.equal(calls.length, 8);
  for (const call of calls) assert.deepEqual(call.text, ["a"]);
});

test("empty values do not need IFS lookup storage", async () => {
  const calls = await inspect({ ifs: "0123456789ABCDEF", value: "", limits: { maxExpansionBytes: 256 } });
  assert.deepEqual(calls[0]!.text, []);
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`duplicate IFS splitting honors asynchronous cancellation ${String(reason)}`, async () => {
    const controller = new AbortController();
    const aborting = setImmediate(() => controller.abort(reason));
    try {
      await assert.rejects(inspect({ ifs: "x".repeat(1024), value: "a", script: "inspect $value$value$value$value", signal: controller.signal }), error => controller.signal.aborted && error === controller.signal.reason);
    } finally { clearImmediate(aborting); }
  });
  test(`pre-aborted splitting preserves cancellation ${String(reason)}`, async () => {
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(inspect({ ifs: "0123456789ABCDEF", value: "a", signal: controller.signal }), error => error === controller.signal.reason);
  });
}
