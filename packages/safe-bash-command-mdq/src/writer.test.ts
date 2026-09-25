import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { admitLimits, MdqBudget, type LimitOptions } from "./budget.js";
import { MdqWriter } from "./writer.js";

function setup(width?: number, limits: LimitOptions = {}) {
  const caller = new AbortController();
  const budget = new MdqBudget({ command: "mdq", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: caller.signal, stdin: toByteSource(new Uint8Array()), stdout: { async write() {} }, stderr: { async write() {} }
  }, admitLimits(limits));
  return { writer: new MdqWriter(budget, width), caller, budget };
}

// These operation/output pairs follow mdq v0.10.0's output.rs and words_buffer.rs
// tests. finish() also applies Output::drop's pending terminal newline.
test("writer keeps raw text literal and emits one terminal newline for a block", async () => {
  const { writer } = setup();
  await writer.write("before");
  await writer.block("plain", async out => { await out.write("hello\nworld\n\nagain"); });
  await writer.write("after");
  assert.equal(writer.finish(), "before\n\nhello\nworld\nagain\n\nafter");
  assert.equal(writer.finish(), "before\n\nhello\nworld\nagain\n\nafter");
});

test("writer quote indentation survives nested preformatted blocks", async () => {
  const { writer } = setup();
  await writer.block("quote", async out => {
    await out.write("hello "); await out.write("world");
    await out.block("quote", async inner => {
      await inner.write("second level");
      await inner.pre(async pre => { await pre.write("```rust\nsome code\nwith\n\nline breaks\n```"); });
    });
  });
  await writer.write("after");
  assert.equal(writer.finish(), "> hello world\n>\n> > second level\n> >\n> > ```rust\n> > some code\n> > with\n> >\n> > line breaks\n> > ```\n\nafter");
});

test("writer list indentation omits first-line padding and preserves paragraph spacing", async () => {
  const { writer } = setup();
  await writer.write("1. ");
  await writer.block({ indent: 3 }, async out => {
    await out.block("plain", async para => { await para.write("First item"); });
    await out.block("plain", async para => { await para.write("It has two paragraphs."); });
  });
  await writer.write("2. ");
  await writer.block({ indent: 3 }, async out => { await out.block("plain", async para => { await para.write("Second item."); }); });
  assert.equal(writer.finish(), "1. First item\n\n   It has two paragraphs.\n2. Second item.\n");
});

test("writer new indent suppresses opening paragraph newlines", async () => {
  const { writer } = setup();
  await writer.write("[^1]: ");
  await writer.block({ indent: 2 }, async out => {
    await out.block("plain", async para => { await para.write("\nFirst paragraph\n\nhas newlines"); });
  });
  assert.equal(writer.finish(), "[^1]: First paragraph\n  has newlines\n");
});

test("writer flushes empty quotes and literal trailing preformatted newlines", async () => {
  const empty = setup().writer;
  await empty.block("quote", () => {});
  assert.equal(empty.finish(), ">\n");
  const literal = setup(3).writer;
  await literal.pre(async out => { await out.write("hello world\n\n"); });
  assert.equal(literal.finish(), "hello world\n\n\n");
});

for (const [width, input, expected] of [
  [3, "hello world", "hello\nworld\n"],
  [5, "hello hi hi", "hello\nhi hi\n"],
  [7, "hello hi hi", "hello\nhi hi\n"],
  [5, "a abcdefghijklmnopqrstuvwxyz z", "a\nabcdefghijklmnopqrstuvwxyz\nz\n"],
  [0, "a hello b", "a\nhello\nb\n"],
  [12, "    hello       world     ", "hello world\n"],
  [11, "hello\r\rfriendly\r\r\r\t\rox", "hello\nfriendly ox\n"]
] as const) {
  test(`writer upstream word-buffer boundary ${width}: ${JSON.stringify(input)}`, async () => {
    const { writer } = setup(width);
    await writer.block("plain", async out => { await out.write(input); });
    assert.equal(writer.finish(), expected);
  });
}

test("writer wraps formatted spans across writes but keeps atomic spans together", async () => {
  const formatted = setup(10).writer;
  await formatted.block("plain", async out => {
    await out.write("a **"); await out.write("bold words"); await out.write("** z");
  });
  assert.equal(formatted.finish(), "a **bold\nwords** z\n");
  const atomic = setup(10).writer;
  await atomic.block("plain", async out => {
    await out.write("a ");
    await out.withoutWrapping(async link => { await link.write("[bold words](url)"); });
    await out.write(" z");
  });
  assert.equal(atomic.finish(), "a\n[bold words](url)\nz\n");
});

test("writer applies upstream first-line and continuation indentation wrapping", async () => {
  const { writer } = setup(11);
  await writer.block("plain", async out => { await out.write("hello world"); });
  for (const [first, second] of [["1. hi world ", "next line"], ["2. hi world ", "next lines"], ["3. hi ", "  worlds hi"], ["4. hi ", "  worlds hey"]]) {
    await writer.block({ indent: 2 }, async out => { await out.write(first!); await out.write(second!); });
  }
  assert.equal(writer.finish(), "hello world\n\n1. hi world\n  next line\n2. hi world\n  next\n  lines\n3. hi\n  worlds hi\n4. hi\n  worlds\n  hey\n");
});

test("writer matches native mdq list and footnote prefix wrapping at width ten", async () => {
  const list = setup(10).writer;
  await list.block("plain", async out => {
    await out.write("- ");
    await out.block({ indent: 2 }, async item => { await item.block("plain", async para => { await para.write("one two three four five"); }); });
  });
  assert.equal(list.finish(), "- one two\n  three\n  four\n  five\n");
  const note = setup(10).writer;
  await note.block("plain", async out => {
    await out.write("[^1]: ");
    await out.block({ indent: 2 }, async body => { await body.block("plain", async para => { await para.write("one two three four five"); }); });
  });
  assert.equal(note.finish(), "[^1]: one\n  two\n  three\n  four\n  five\n");
});

test("writer width counts Unicode scalars and uses Rust whitespace boundaries", async () => {
  const { writer } = setup(3);
  await writer.block("plain", async out => { await out.write("😀\u0085😀\u00a0é"); });
  assert.equal(writer.finish(), "😀 😀\né\n");
});

test("writer admits UTF-8 output, retained storage, work and block depth before growth", async () => {
  const exact = setup(undefined, { outputBytes: 3 }).writer;
  await exact.block("plain", async out => { await out.write("é"); });
  assert.equal(exact.finish(), "é\n");
  const bytes = setup(undefined, { outputBytes: 2 }).writer;
  await bytes.block("plain", async out => { await out.write("é"); });
  assert.throws(() => bytes.finish(), /outputBytes limit/);
  for (const [limits, resource] of [[{ retainedBytes: 0 }, "retainedBytes"], [{ work: 0 }, "work"]] as const) {
    const limited = setup(undefined, limits).writer;
    await assert.rejects(limited.write("x"), new RegExp(resource + " limit"));
  }
  const nested = setup(undefined, { depth: 0 }).writer;
  await assert.rejects(nested.block("quote", () => {}), /depth limit/);
});

test("writer observes scheduled cancellation during a long string", async () => {
  const { writer, caller } = setup(), reason = new Error("stop writer");
  const execution = writer.write("a".repeat(12_000));
  const cancelled = setImmediate().then(() => caller.abort(reason));
  await assert.rejects(execution, error => error === reason); await cancelled;
});
