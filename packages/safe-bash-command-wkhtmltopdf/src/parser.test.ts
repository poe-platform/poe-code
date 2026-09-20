import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInvocation, tokenizeBatchLine, switches, WkhtmltopdfError } from "./index.js";
import type { ParseLimits } from "./index.js";

const limits = { maxArguments: 128, maxTextBytes: 8192, maxObjects: 8, maxWork: 16384 };
const parse = (argv: readonly string[]) => parseInvocation(argv, { limits });

test("cancellation raised during argument admission preserves its exact reason", () => {
  const controller = new AbortController();
  const args = ["input.html", "output.pdf"];
  Object.defineProperty(args, "0", { get() { controller.abort(false); return "input.html"; } });
  assert.throws(() => parseInvocation(args, { limits, signal: controller.signal }), error => error === false);
});

test("pinned inventory retains all 122 switches and scopes", () => {
  assert.equal(switches.length, 122);
  assert.equal(new Set(switches.map(s => s.name)).size, 122);
  for (const [scope, count] of [["global", 35], ["page", 81], ["toc", 6]] as const) {
    assert.equal(switches.filter(s => s.scope === scope).length, count);
  }
});

test("defaults, scoped clones and cover normalization stay distinct", () => {
  const job = parse(["--header-left", "Inherited", "cover", "cover.html", "--header-right", "Clear", "--include-in-outline", "page", "body.html", "--header-left", "Body", "second.html", "out.pdf"]);
  assert.equal(job.global.dpi, 96);
  assert.equal(job.global.marginTop.value, -1);
  assert.equal(job.objects[0]?.settings.header.left, "");
  assert.equal(job.objects[0]?.settings.header.right, "");
  assert.equal(job.objects[0]?.settings.includeInOutline, false);
  assert.equal(job.objects[0]?.settings.pagesCount, true);
  assert.equal(job.objects[1]?.settings.header.left, "Body");
  assert.equal(job.objects[2]?.settings.header.left, "Inherited");
  assert.notEqual(job.objects[1]?.settings.header, job.objects[2]?.settings.header);
});

test("TOC accepts page and TOC options, not globals", () => {
  const job = parse(["toc", "--toc-header-text", "Index", "--footer-left", "Footer", "out.pdf"]);
  assert.equal(job.objects[0]?.kind, "toc");
  assert.equal(job.objects[0]?.settings.toc.captionText, "Index");
  assert.equal(job.objects[0]?.settings.footer.left, "Footer");
  assert.throws(() => parse(["a", "--copies", "2", "out"]), { code: "OPTION_LOCATION", exitCode: 1 });
  assert.throws(() => parse(["--toc-header-text", "Index", "a", "out"]), { code: "OPTION_LOCATION" });
});

test("exact long tokens and grouped shorts use separate operands", () => {
  assert.equal(parse(["-qO", "Landscape", "a", "out"]).global.orientation, "Landscape");
  assert.throws(() => parse(["--copies=2", "a", "out"]), { code: "UNKNOWN_OPTION" });
  assert.throws(() => parse(["-d96", "a", "out"]), WkhtmltopdfError);
  assert.throws(() => parse(["--", "a", "out"]), { code: "UNQUALIFIED_QUIRK" });
  assert.throws(() => parse(["--0unsafe", "a", "out"]), { code: "UNQUALIFIED_QUIRK" });
});

test("ordered duplicate replacements append instead of overwriting", () => {
  const job = parse(["--replace", "key", "first", "a", "--replace", "key", "second", "out"]);
  assert.deepEqual(job.objects[0]?.settings.replacements, [["key", "first"], ["key", "second"]]);
});

test("default header uses the actual Caller literal and alters global margins", () => {
  const job = parse(["a", "--default-header", "--page-offset", "7", "--keep-relative-links", "out"]);
  assert.equal(job.objects[0]?.settings.header.right, "[page]/[topage]");
  assert.deepEqual(job.global.marginTop, { value: 20, unit: "mm" });
  assert.equal(job.global.pageOffset, 7);
  assert.equal(job.global.resolveRelativeLinks, false);
});

test("information and batch modes do not fabricate conversion objects", () => {
  assert.equal(parse(["--help"]).mode, "information");
  const batch = parse(["--read-args-from-stdin", "--header-left", "Inherited"]);
  assert.equal(batch.mode, "batch");
  assert.deepEqual(batch.objects, []);
  assert.equal(batch.pageDefaults.header.left, "Inherited");
});

test("binary32 conversion and checked integers are explicit", () => {
  assert.equal(parse(["--zoom", "0.8", "a", "out"]).objects[0]?.settings.load.zoomFactor, Math.fround(0.8));
  for (const value of ["NaN", "Infinity", "1e100", "0", "-1", "1junk"]) {
    assert.throws(() => parse(["--zoom", value, "a", "out"]), { code: "INVALID_VALUE" });
  }
  for (const value of ["2.5", "2147483648", "0", "1e2"]) {
    assert.throws(() => parse(["--copies", value, "a", "out"]), { code: "INVALID_VALUE" });
  }
});

test("all margins must share units, including unchanged defaults", () => {
  assert.deepEqual(parse(["--margin-left", "1cm", "a", "out"]).global.marginLeft, { value: 10, unit: "mm" });
  assert.throws(() => parse(["--margin-left", "1in", "a", "out"]), { code: "MARGIN_UNITS" });
  const job = parse(["-L", "1in", "-R", "1in", "-T", "1in", "-B", "1in", "a", "out"]);
  assert.deepEqual(job.global.marginLeft, { value: 1, unit: "in" });
});

test("missing operands, inputs and output fail structurally", () => {
  assert.throws(() => parse(["--replace", "key"]), { code: "MISSING_OPERAND" });
  for (const argv of [[], ["out"], ["cover", "out"], ["page", "out"]]) {
    assert.throws(() => parse(argv), { exitCode: 1 });
  }
  assert.equal(parse(["-", "-"]).output, "-");
});

test("the final output operand is literal even when it looks like a switch", () => {
  assert.equal(parse(["input.html", "--literal-output.pdf"]).output, "--literal-output.pdf");
  assert.equal(parse(["input.html", "-output.pdf"]).output, "-output.pdf");
});

test("unavailable resources, dynamic execution and X server fail explicitly", () => {
  for (const entry of switches.filter(s => s.disposition !== "static")) {
    const operands = Array.from({ length: entry.arity }, () => "value");
    const argv = entry.scope === "toc" ? ["toc", entry.name, ...operands, "out"] : [entry.name, ...operands, "a", "out"];
    assert.throws(() => parse(argv), { code: "UNSUPPORTED_CAPABILITY", option: entry.name });
  }
});

test("batch tokenizer is source-specific, without shell expansion", () => {
  assert.deepEqual(tokenizeBatchLine("a 'b\\ c' \"\" '' '$HOME' \"unclosed", { limits }), ["a", "b c", "$HOME", "unclosed"]);
  assert.deepEqual(tokenizeBatchLine("a\\ b c\\", { limits }), ["a b", "c"]);
});

test("cancellation preserves even falsey reasons before parsing", () => {
  const controller = new AbortController();
  controller.abort(0);
  let caught = false;
  try { parseInvocation(["a", "out"], { limits, signal: controller.signal }); }
  catch (error) { caught = true; assert.equal(error, 0); }
  assert.equal(caught, true);
});

test("arguments, UTF-8 bytes, work and object budgets fail at admission", () => {
  for (const override of [{ maxArguments: 1 }, { maxTextBytes: 2 }, { maxWork: 1 }, { maxObjects: 1 }]) {
    assert.throws(() => parseInvocation(["é", "b", "out"], { limits: { ...limits, ...override } }), { code: "LIMIT_EXCEEDED" });
  }
  assert.throws(() => tokenizeBatchLine("a b", { limits: { ...limits, maxArguments: 1 } }), { code: "LIMIT_EXCEEDED" });
});

test("runtime callers cannot omit a required limit and bypass accounting", () => {
  for (const name of Object.keys(limits)) {
    const missing: Record<string, number> = { ...limits };
    delete missing[name];
    assert.throws(() => parseInvocation(["a", "out"], { limits: missing as unknown as ParseLimits }), { code: "INVALID_VALUE" });
  }
});
