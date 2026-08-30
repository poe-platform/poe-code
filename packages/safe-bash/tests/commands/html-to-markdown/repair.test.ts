import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "../../../src/commands/html-to-markdown/budget.js";
import { destination, entities } from "../../../src/commands/html-to-markdown/entities.js";
import { settings } from "../../../src/commands/html-to-markdown/options.js";
import { createHtmlToMarkdownCommand } from "../../../src/commands/html-to-markdown/index.js";
import { normalizeText, trimText } from "../../../src/commands/html-to-markdown/text.js";
import { byteChunks, convert } from "./helpers.js";

const literals: readonly [string, string][] = [
  ["<p>1. ordinary sentence</p>", "1\\. ordinary sentence\n"],
  ["<p>1) ordinary sentence</p>", "1\\) ordinary sentence\n"],
  ["<p>~~ordinary~~</p>", "\\~\\~ordinary\\~\\~\n"],
  ["<p>text<br>===</p>", "text  \n\\=\\=\\=\n"],
  ["<p>1<span>.</span> ordinary</p>", "1\\. ordinary\n"],
  ["<p><em>a</em><em>b</em></p>", "*ab*\n"],
  ["<strong>a</strong><b>b</b>", "**ab**\n"],
  ["<s>a</s><del>b</del>", "~~ab~~\n"],
  ["<em>a</em><span><i>b</i></span>", "*ab*\n"],
  ["<em>a<em>b</em>c</em>", "*abc*\n"],
  ["<p>A<em>B", "A*B*\n"],
  ["<p>Hello <strong>world</strong>.</p>", "Hello **world**.\n"],
  ["<em>a</em><strong>b</strong>", "*a*__b__\n"],
  ["<strong>a</strong><em>b</em>", "__a__*b*\n"],
  ["a<em>!</em>b", "&#97;*\\!*&#98;\n"],
  ["<code>1. ~~x~~ =</code>", "`1. ~~x~~ =`\n"],
  ["<pre>1. ~~x~~ =</pre>", "```\n1. ~~x~~ =\n```\n"],
  ['<a href="&#9;https://safe.test">label</a>', "label\n"],
  ['<img src="https://safe.test&#10;" alt="label">', "label\n"],
  ['<a href="&#9;javascript:alert(1)">label</a>', "label\n"],
  ['<a href=" https://safe.test ">label</a>', "[label](<https://safe.test>)\n"],
  ['<a href="https://safe.test/%0A">label</a>', "label\n"],
  ['<a href="https://safe.test/&unknown;">label</a>', "label\n"],
];
for (const [input, expected] of literals) test(`repair literal ${input}`, async () => {
  for (const chunk of [1, 7, 4096]) {
    const result = await convert(byteChunks(input, chunk));
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, expected); assert.equal(result.stderr, "");
  }
});

for (const [reference, decoded] of [["&amp;", "\\&"], ["&#1114112;", "�"], ["&#x1f600;", "😀"], ["&unknown;", "\\&unknown;"]] as const) {
  test(`entity token boundary rejects instead of reinterpreting ${reference}`, async () => {
    for (const chunk of [1, 2, 7]) {
      for (const cap of [reference.length - 1, reference.length, reference.length + 1]) {
        const result = await convert(byteChunks(reference, chunk), { limits: { maxTokenBytes: cap } });
        if (cap < reference.length) {
          assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /EFBIG.*token bytes/u);
        } else { assert.equal(result.exitCode, 0); assert.equal(result.stdout, decoded + "\n"); }
      }
    }
  });
}

test("numeric entity too large for text token fails explicitly inside an element", async () => {
  const result = await convert("<p>&#1114112;</p>", { limits: { maxTokenBytes: 8 } });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /EFBIG/u);
});

test("destination rejects every edge C0/C1 control before ASCII-space trimming", async () => {
  const context = (await convert("")).context;
  for (const scalar of [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => 127 + index)]) {
    for (const side of ["before", "after"]) {
      const control = String.fromCodePoint(scalar), url = "https://safe.test/path";
      assert.equal(await destination(side === "before" ? control + url : url + control, false, new Budget(context, settings({}))), undefined);
    }
  }
});

test("trim visits edges only and charges a requested copy", async () => {
  const context = (await convert("")).context;
  const internal = "x" + " ".repeat(131072) + "x";
  assert.equal(await trimText(internal, new Budget(context, settings({ limits: { maxWorkUnits: 2 } }))), internal);
  await assert.rejects(trimText(" " + internal, new Budget(context, settings({ limits: { maxWorkUnits: 3 } }))), { code: "EFBIG" });
  assert.equal(await trimText(" \t\r\n x \t", new Budget(context, settings({}))), "x");
});

test("destination reference scan charges work before scanning an adversarial suffix", async () => {
  const context = (await convert("")).context;
  await assert.rejects(destination("https://safe.test/" + "&#".repeat(65536), false, new Budget(context, settings({ limits: { maxWorkUnits: 64 } }))), { code: "EFBIG" });
});

test("Group E destination retains named references without rejecting ordinary ampersands", async () => {
  for (const [url, expected] of [
    ["https://safe.test/&unknown;", "label\n"],
    ["https://safe.test/&ab12;", "label\n"],
    ["javascript&colon;alert(1)", "label\n"],
    ["java&Tab;script:alert(1)", "label\n"],
    ["https://safe.test/?a=1&b=2", "[label](<https://safe.test/?a=1&b=2>)\n"],
    ["https://safe.test/&name", "[label](<https://safe.test/&name>)\n"],
    ["https://safe.test/&ab-;", "[label](<https://safe.test/&ab-;>)\n"],
  ] as const) {
    for (const size of [1, 7, 4096]) {
      const result = await convert(byteChunks(`<a href="${url}">label</a>`, size));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected, url);
      assert.equal(result.stderr, "");
    }
  }
});

test("Group E named-reference continuation preserves every work and cancellation checkpoint", async context => {
  const commandContext = (await convert("")).context;
  const value = "https://safe.test/&ab12;";
  const budget = new Budget(commandContext, settings({ limits: { maxWorkUnits: value.length } }));
  const checkpoint = context.mock.method(budget, "checkpoint");
  assert.equal(await destination(value, false, budget), undefined);
  assert.equal(checkpoint.mock.callCount(), value.length - 1);
  await assert.rejects(destination(value, false, new Budget(commandContext, settings({ limits: { maxWorkUnits: value.length - 1 } }))), { code: "EFBIG" });

  const controller = new AbortController(), reason = Object.freeze({ phase: "named-reference" });
  const cancelled = new Budget({ ...commandContext, signal: controller.signal }, settings({}));
  const original = cancelled.checkpoint.bind(cancelled);
  let checkpoints = 0;
  context.mock.method(cancelled, "checkpoint", async () => {
    if (++checkpoints === value.indexOf("b") + 1) controller.abort(reason);
    await original();
  });
  await assert.rejects(destination(value, false, cancelled), error => error === reason);
  assert.equal(checkpoints, value.indexOf("b") + 1);
});

test("Group E command cancellation with a long named reference retains the caller reason", async () => {
  const controller = new AbortController(), reason = Object.freeze({ phase: "html-command" });
  const context = (await convert("")).context;
  const handle = setImmediate(() => controller.abort(reason));
  try {
    await assert.rejects(async () => createHtmlToMarkdownCommand().execute({
      ...context, signal: controller.signal,
      stdin: byteChunks('<a href="https://safe.test/&' + "a".repeat(32768) + '">label</a>', 4096),
    }), error => error === reason);
  } finally { clearImmediate(handle); }
});

for (const operation of ["trim", "destination", "entities", "normalize"] as const) test(`${operation} scan yields and preserves exact caller reason`, async () => {
  const controller = new AbortController(), reason = Object.freeze({ operation });
  const context = (await convert("")).context, budget = new Budget({ ...context, signal: controller.signal }, settings({}));
  const handle = setImmediate(() => controller.abort(reason));
  try {
    const promise = operation === "trim" ? trimText(" ".repeat(131072), budget)
      : operation === "destination" ? destination("https://safe.test/" + "&#".repeat(65536), false, budget)
      : operation === "entities" ? entities("&".repeat(131072), budget)
      : normalizeText(" ".repeat(131072), budget, "space");
    await assert.rejects(promise, error => error === reason);
  } finally { clearImmediate(handle); }
});
