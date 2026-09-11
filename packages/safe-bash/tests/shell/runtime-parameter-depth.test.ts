import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CommandRegistry, toByteSource, writeText } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createRootCancellationLink } from "../../src/shell/cancellation.js";
import { InvocationScope, invocationScope } from "../../src/shell/cleanup.js";
import { parseShell } from "../../src/shell/parser.js";
import type { Word, WordPart } from "../../src/shell/parser.js";
import { Budget, Capture, resolveLimits, Runtime, RuntimeCancellationState } from "../../src/shell/runtime.js";
import type { State } from "../../src/shell/runtime.js";
import { ShellLimitError, ShellSyntaxError } from "../../src/shell/types.js";
import type { ShellLimits } from "../../src/shell/types.js";

const literal: Word = { offset: 17, parts: [{ kind: "text", value: "1", quoted: true }] };
const alternate: Word = { offset: 10, parts: [{ kind: "variable", name: "inner", quoted: true, operator: ":-", alternate: literal }] };
const nested: Word = { offset: 0, parts: [{ kind: "variable", name: "outer", quoted: true, operator: ":-", alternate }] };

function fixture(context: TestContext, depth: number, limits: ShellLimits = {}, signal?: AbortSignal) {
  const budget = new Budget(resolveLimits(limits), signal);
  const scope = new InvocationScope(signal);
  const cancellationState = new RuntimeCancellationState();
  const admission = Runtime.rootCancellationAdmission(budget);
  const cancellation = createRootCancellationLink({ admission, callerSignal: signal, controls: [{ role: "budget-control", signal: budget.controller.signal }] });
  const commands = new CommandRegistry([{ name: "emit", async execute({ args, stdout }) { await writeText(stdout, `${args.join(" ")}\n`); return { exitCode: 0 }; } }]);
  const runtime = new Runtime(new MemoryFileSystem(), commands, [], budget,
    AbortSignal.any([cancellation.deliverySignal, scope.signal]), undefined, undefined,
    cancellation.deliverySignal, cancellation, cancellationState, undefined, 0, admission.maxDepth);
  const state: State = {
    cwd: "/", variables: { value: "a1b" }, exported: new Set(), functions: new Map(), positional: [],
    status: 0, substitutionStatus: 0, depth, loopDepth: 0, functionDepth: 0, locals: [], pipefail: false,
  };
  const stdout = new Capture();
  const stderr = new Capture();
  const io: Parameters<Runtime["word"]>[2] = { [invocationScope]: scope, stdin: toByteSource(""), stdout, stderr };
  context.after(async () => {
    budget.close();
    await scope.close();
    cancellationState.close();
    budget.values.close();
    assert.deepEqual(cancellation.close().failures, []);
    assert.deepEqual(scope.failures, []);
  });
  return { runtime, state, io, stdout, stderr, budget };
}

function depthFailure(error: unknown): boolean {
  assert.ok(error instanceof ShellSyntaxError);
  assert.equal(error.reason, "Syntax nesting exceeds 64");
  assert.equal(error.exitCode, 2);
  return true;
}

test("runtime admits handwritten operands independently of parsing at the inclusive boundary", async context => {
  const { runtime, state, io } = fixture(context, 63);
  assert.deepEqual(await runtime.word(alternate, state, io), ["1"]);
  await assert.rejects(runtime.word(nested, state, io), error => {
    assert.ok(error instanceof ShellSyntaxError);
    assert.equal(error.offset, literal.offset);
    return depthFailure(error);
  });
  assert.deepEqual(await runtime.word(nested, { ...state, depth: 62 }, io), ["1"]);
  assert.equal(state.depth, 63);
});

test("direct part entry cannot bypass runtime operand admission", async context => {
  const { runtime, state, io } = fixture(context, 63);
  const part = nested.parts[0]!;
  assert.equal(part.kind, "variable");
  if (part.kind !== "variable") assert.fail("variable fixture required");
  await assert.rejects(runtime.part(part, state, io), depthFailure);
});

for (const part of [
  { kind: "variable", name: "outer", quoted: true, operator: ":=", alternate },
  { kind: "variable", name: "value", quoted: true, operator: ":+", alternate },
  { kind: "variable", name: "value", quoted: true, operator: "#", alternate },
  { kind: "variable", name: "value", quoted: true, operator: "%%", alternate },
  { kind: "variable", name: "value", quoted: true, operator: "/", alternate, replacement: literal },
  { kind: "variable", name: "value", quoted: true, operator: "//", alternate: literal, replacement: alternate },
  { kind: "variable", name: "value", quoted: true, substring: { offset: alternate, source: "${value:${inner:-1}}" } },
  { kind: "variable", name: "value", quoted: true, substring: { offset: literal, length: alternate, source: "${value:1:${inner:-1}}" } },
] satisfies WordPart[]) {
  test(`runtime guards evaluated ${part.operator ?? part.substring?.source} operands`, async context => {
    const { runtime, state, io } = fixture(context, 63);
    await assert.rejects(runtime.part(part, state, io), depthFailure);
    await assert.doesNotReject(runtime.part(part, { ...state, variables: { ...state.variables }, depth: 62 }, io));
    assert.equal(state.variables.outer, undefined);
  });
}

test("question alternates retain parameter failure below the depth boundary", async context => {
  const { runtime, state, io } = fixture(context, 63);
  const part = { kind: "variable", name: "outer", quoted: true, operator: ":?", alternate } as const;
  await assert.rejects(runtime.part(part, state, io), depthFailure);
  await assert.rejects(runtime.part(part, { ...state, depth: 62 }, io), error => {
    assert.ok(error instanceof Error);
    assert.equal(error instanceof ShellSyntaxError, false);
    assert.equal(error.message, "outer: 1");
    return true;
  });
});

test("direct pattern and substring helpers admit their own operands", async context => {
  const { runtime, state, io } = fixture(context, 63);
  await assert.rejects(runtime.parameterPattern({ kind: "variable", name: "value", quoted: true, operator: "#", alternate }, "a1b", state, io, false), depthFailure);
  await assert.rejects(runtime.substring({ kind: "variable", name: "value", quoted: true, substring: { offset: alternate, source: "${value:${inner:-1}}" } }, "a1b", state, io), depthFailure);
});

test("runtime skips unevaluated operands and does not charge plain words", async context => {
  const { runtime, state, io } = fixture(context, 64);
  assert.deepEqual(await runtime.word(literal, state, io), ["1"]);
  assert.equal(await runtime.part({ kind: "variable", name: "value", quoted: true, operator: ":-", alternate }, state, io), "a1b");
  assert.equal(await runtime.part({ kind: "variable", name: "missing", quoted: true, operator: ":+", alternate }, state, io), "");
  assert.equal(await runtime.part({ kind: "variable", name: "missing", quoted: true, substring: { offset: alternate, source: "${missing:${inner:-1}}" } }, state, io), "");
});

test("sibling operands and overlapping evaluations do not share depth", async context => {
  const { runtime, state, io } = fixture(context, 62);
  const parentIO = Object.freeze({ ...io });
  const keys = Reflect.ownKeys(parentIO);
  assert.deepEqual(await Promise.all([
    runtime.word(nested, { ...state, variables: { ...state.variables } }, parentIO),
    runtime.word(nested, { ...state, variables: { ...state.variables } }, parentIO),
  ]), [["1"], ["1"]]);
  assert.deepEqual(await runtime.words([alternate, alternate], { ...state, depth: 63 }, parentIO), ["1", "1"]);
  assert.deepEqual(await runtime.word({ offset: 0, parts: [...nested.parts, ...nested.parts] }, state, parentIO), ["11"]);
  await assert.rejects(runtime.word(nested, { ...state, depth: 63 }, parentIO), depthFailure);
  assert.deepEqual(await runtime.word(nested, state, parentIO), ["1"]);
  assert.deepEqual(Reflect.ownKeys(parentIO), keys);
  assert.equal(state.depth, 62);
});

test("replacement and substring siblings start from the same parent depth", async context => {
  const { runtime, state, io } = fixture(context, 62);
  assert.equal(await runtime.part({ kind: "variable", name: "value", quoted: true, operator: "/", alternate, replacement: alternate }, state, io), "a1b");
  assert.equal(await runtime.part({ kind: "variable", name: "value", quoted: true, substring: { offset: alternate, length: alternate, source: "${value:${inner:-1}:${inner:-1}}" } }, state, io), "1");
});

test("runtime parameter depth failure maps to status 2 before command effects", async context => {
  const { runtime, state, io, stdout, stderr } = fixture(context, 63);
  assert.equal(await runtime.runCommandString("emit ${outer:-${inner:-1}}", state, io), 2);
  assert.equal(new TextDecoder().decode(stdout.bytes()), "");
  assert.ok(new TextDecoder().decode(stderr.bytes()).includes("syntax error"));
});

test("indexed assignment alternates preserve depth admission and leave failed assignment unpublished", async context => {
  const { runtime, state, io, stdout } = fixture(context, 63);
  assert.equal(await runtime.runCommandString("items=(); emit \"${items:=${inner:-1}}\"", state, io), 2);
  assert.equal(new TextDecoder().decode(stdout.bytes()), "");
  assert.equal(await runtime.runCommandString('emit "${items[0]}"', state, io), 0);
  assert.equal(new TextDecoder().decode(stdout.bytes()), "\n");
  assert.equal(await runtime.runCommandString('emit "${items:=${inner:-1}}"', { ...state, depth: 62 }, io), 0);
  assert.equal(new TextDecoder().decode(stdout.bytes()), "\n1\n");
});

test("deferred heredocs enforce runtime depth independently of their parser depth", async context => {
  const { runtime, state, io } = fixture(context, 63);
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${outer:-${inner:-1}}", endLine: 1, depth: 0 };
  await assert.rejects(runtime.document(document, state, io), depthFailure);
  assert.equal(await runtime.document(document, { ...state, depth: 62 }, io), "1");
  assert.equal(await runtime.document({ ...document, quoted: true }, state, io), document.body);
});

test("substitution inherits the active operand depth without double-counting child state", async context => {
  const { runtime, state, io } = fixture(context, 62);
  const substitution: Word = { offset: 8, parts: [{ kind: "substitution", quoted: true, line: 1, script: parseShell("emit child") }] };
  const word: Word = { offset: 0, parts: [{ kind: "variable", name: "outer", quoted: true, operator: ":-", alternate: substitution }] };
  assert.deepEqual(await runtime.word(word, state, io), ["child"]);
  await assert.rejects(runtime.word(word, { ...state, depth: 63 }, io), depthFailure);
  assert.equal(state.depth, 62);
});

test("operands inside substitution inherit the child state depth", async context => {
  const { runtime, state, io } = fixture(context, 61);
  const part = { kind: "substitution", quoted: true, line: 1, script: parseShell("emit ${outer:-${inner:-1}}") } as const;
  assert.equal(await runtime.part(part, state, io), "1");
  await assert.rejects(runtime.part(part, { ...state, depth: 62 }, io), depthFailure);
});

test("an existing substitution limit takes precedence over combined operand depth", async context => {
  const { runtime, state, io } = fixture(context, 63, { maxSubstitutionDepth: 63 });
  const word: Word = { offset: 0, parts: [{ kind: "variable", name: "outer", quoted: true, operator: ":-", alternate: { offset: 8, parts: [{ kind: "substitution", quoted: true, line: 1, script: parseShell("emit child") }] } }] };
  await assert.rejects(runtime.word(word, state, io), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
});

test("standalone substitution retains an explicitly larger existing limit", async context => {
  const { runtime, state, io } = fixture(context, 64, { maxSubstitutionDepth: 65 });
  assert.equal(await runtime.part({ kind: "substitution", quoted: true, line: 1, script: parseShell("emit child") }, state, io), "child");
});

for (const reason of [null, false, 0, ""]) {
  test(`falsey cancellation precedes runtime depth admission: ${JSON.stringify(reason)}`, async context => {
    const controller = new AbortController();
    const { runtime, state, io } = fixture(context, 63, {}, controller.signal);
    controller.abort(reason);
    await assert.rejects(runtime.word(nested, state, io), error => Object.is(error, reason));
    await assert.rejects(runtime.part({ kind: "substitution", quoted: true, line: 1, script: { lists: [] } }, { ...state, depth: 64 }, io), error => Object.is(error, reason));
  });
}
