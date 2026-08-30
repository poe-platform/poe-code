const encoded = text => Buffer.from(text).toString("base64");
const underFixture = entry => entry.path === "/fixture" || entry.path.startsWith("/fixture/") || entry.path === "/tmp" || entry.path.startsWith("/tmp/");
export function stable(entry) {
  return { path: entry.path, type: entry.type, ...(entry.mode === undefined ? {} : { mode: entry.mode & 0o7777 }), ...(entry.base64 === undefined ? {} : { base64: entry.base64 }), ...(entry.target === undefined ? {} : { target: entry.target }) };
}
export function effects(before, after) {
  if (!before || !after) return null;
  const previous = new Map(before.entries.map(entry => [entry.path, stable(entry)]));
  const next = new Map(after.entries.map(entry => [entry.path, stable(entry)]));
  return [...new Set([...previous.keys(), ...next.keys()])].sort().filter(filename => JSON.stringify(previous.get(filename)) !== JSON.stringify(next.get(filename))).map(filename => ({ path: filename, before: previous.get(filename) ?? null, after: next.get(filename) ?? null }));
}
export function assess(specimen, capture) {
  const report = capture.report;
  const failures = [];
  const checks = [];
  const check = (label, passes, detail = null) => { checks.push({ label, passes, detail }); if (!passes) failures.push(label); };
  if (!report || capture.parentTimeout || capture.exitCode !== 0 || capture.signal) return { classification: capture.parentTimeout ? "timeout" : "harness-error", operationalCredit: false, failures: ["child did not return normally"], checks, effects: null };
  if (report.captureErrors.length) return { classification: "setup-unavailable", operationalCredit: false, failures: report.captureErrors, checks, effects: effects(report.before, report.after) };
  if (report.executionError) return { classification: /budget|timeout|abort/i.test(report.executionError.message) ? "timeout" : "execution-error", operationalCredit: false, failures: [report.executionError], checks, effects: effects(report.before, report.after) };
  check("complete before/after VFS census", report.before?.complete === true && report.after?.complete === true);
  const result = report.result;
  if (specimen.expected) {
    const expected = specimen.expected;
    check("exit status", result.exitCode === expected.exitCode, { expected: expected.exitCode, actual: result.exitCode });
    for (const key of ["stdoutBase64", "stderrBase64"]) if (key in expected) check(key, result[key] === expected[key], { expected: expected[key], actual: result[key] });
    for (const value of expected.stdoutIncludes ?? []) check(`stdout includes ${JSON.stringify(value)}`, result.stdout.includes(value));
    for (const value of expected.stdoutExcludes ?? []) check(`stdout excludes ${JSON.stringify(value)}`, !result.stdout.includes(value));
    if (expected.elapsedAtLeastMs !== undefined) check("loose product-exec sleep lower bound", report.productElapsedMs >= expected.elapsedAtLeastMs, { expectedMinMs: expected.elapsedAtLeastMs, actualMs: report.productElapsedMs });
    const after = new Map(report.after.entries.map(entry => [entry.path, entry]));
    for (const [relative, requirement] of Object.entries(expected.files)) {
      const entry = after.get(`/fixture/${relative}`);
      check(`file exists: ${relative}`, entry?.type === "file");
      if (requirement.base64 !== undefined) check(`file bytes: ${relative}`, entry?.base64 === requirement.base64);
      const bytes = Buffer.from(entry?.base64 ?? "", "base64");
      if (requirement.prefixBase64 !== undefined) check(`file prefix: ${relative}`, bytes.subarray(0, Buffer.from(requirement.prefixBase64, "base64").length).toString("base64") === requirement.prefixBase64);
      if (requirement.minBytes !== undefined) check(`file minimum bytes: ${relative}`, bytes.length >= requirement.minBytes);
      for (const value of requirement.includes ?? []) check(`file contains ${value}: ${relative}`, bytes.includes(Buffer.from(value)));
    }
    for (const relative of expected.absent) check(`path absent: ${relative}`, !after.has(`/fixture/${relative}`));
    if (expected.preserveInputs) for (const before of report.before.entries.filter(entry => underFixture(entry) && entry.path !== "/fixture" && entry.path !== "/tmp")) {
      const current = after.get(before.path);
      check(`preserve input: ${before.path}`, current !== undefined && JSON.stringify(stable(current)) === JSON.stringify(stable(before)));
    }
    for (const [relative, fixture] of Object.entries(specimen.files)) {
      const initial = report.before.entries.find(entry => entry.path === `/fixture/${relative}`);
      check(`fixture initial bytes: ${relative}`, initial?.base64 === fixture.base64);
      if (fixture.mode !== undefined) check(`fixture initial mode: ${relative}`, (initial?.mode & 0o7777) === fixture.mode);
    }
    for (const [relative, target] of Object.entries(specimen.symlinks)) {
      const initial = report.before.entries.find(entry => entry.path === `/fixture/${relative}`);
      check(`fixture initial symlink: ${relative}`, initial?.type === "symlink" && initial.target === target);
    }
  }
  const namedMissing = new RegExp(`${specimen.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (?:command )?not found`).test(result.stderr);
  const blocked = (specimen.prerequisites ?? []).some(name => result.stderr.includes(`${name}: command not found`));
  let classification;
  if (blocked) classification = "dependency-blocked";
  else if (namedMissing && result.exitCode === 127) classification = "missing-handler";
  else if (report.engine === "ours" && result.exitCode === 2 && /unsupported parameter expansion|unexpected token|Background execution/i.test(result.stderr)) classification = "syntax-blocked-before-target";
  else if (specimen.cohort === "direct-diagnostic") classification = "direct-target-observed-no-functional-credit";
  else if (specimen.name === "node" && report.engine === "baseline") classification = "baseline-stub";
  else if (["js-exec", "python", "python3", "sqlite3"].includes(specimen.name) && result.exitCode !== 0 && /worker|wasm|runtime|module|security|initializ|timed out/i.test(result.stderr)) classification = "optional-runtime-unavailable";
  else if (specimen.name === "help") classification = "documentation-only";
  else if (specimen.name === "wait") classification = "no-op-not-operational-proof";
  else if (failures.length === 0) classification = "functional-positive";
  else classification = "partial-functionality";
  return { classification, operationalCredit: classification === "functional-positive" && specimen.operationalCredit !== false, expectationSatisfied: specimen.expected === null ? null : failures.length === 0, failures, checks, effects: effects(report.before, report.after), fixtureState: report.after.entries.filter(underFixture).map(stable), rawStatus: result.exitCode, rawStdoutBase64: result.stdoutBase64, rawStderrBase64: result.stderrBase64 };
}
