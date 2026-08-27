import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function buildFrozenCohort() {
  const archive = JSON.parse(readFileSync(new URL("./design-v1/archive.json", import.meta.url), "utf8"));
  const decode = name => JSON.parse(Buffer.from(archive.files[name].base64, "base64").toString("utf8"));
  const rawNames = ["raw.json", "followup-raw.json", "ordering-raw.json"];
  const raw = rawNames.flatMap(rawFile => decode(rawFile).map(row => ({ ...row, rawFile })));
  const fixtures = [];
  const unquote = value => value === "''" ? "" : value.replace(/\\(.)/gu, "$1");
  const snapshot = (caseId, label) => {
    const row = raw.find(row => row.profile === "bash53" && row.id === caseId);
    if (!row) throw new Error(`Missing case ${caseId}`);
    const line = row.stdout.split("\n").find(line => line.startsWith(`${label} rc=`));
    const match = /^(.*?) rc=(\d+) opt=(.*?) I=(.*?) Iset=(.*?) A=(.*?) Aset=(.*?) E=(.*?) pos=/u.exec(line ?? "");
    if (!match) throw new Error(`Missing snapshot ${caseId}/${label}`);
    return {
      source: { rawFile: row.rawFile, caseId, profile: "bash53", label, line },
      values: { status: Number(match[2]), option: unquote(match[3]), optind: Number(match[4]), argument: match[7] === "yes" ? { kind: "set", value: unquote(match[6]) } : { kind: "unset" } },
    };
  };
  const scan = (caseId, label, optstring, args, kind = "option", diagnostic = null, reportErrors = true) => {
    const observed = snapshot(caseId, label);
    return { operation: "scan", optstring, args, reportErrors, source: observed.source, expected: { kind, ...observed.values, diagnostic } };
  };
  const index = value => ({ operation: "index", value });
  const add = (id, operations) => fixtures.push({ id, operations });
  const unknown = option => ({ kind: "unknown-option", option });
  const missing = option => ({ kind: "missing-argument", option });
  add("explicit-versus-selected-positionals", [scan("initial-and-explicit", "explicit", "ab:", ["-b", "explicit"]), index(1), scan("initial-and-explicit", "positional", "ab:", ["-a", "-b", "positional"])]);
  add("clusters-and-required-values", [1, 2, 3, 4, 5, 6].map(step => scan("clusters-arguments", String(step), "ab:c:", ["-abcVALUE", "-b", "separate", "-a"], step > 4 ? "end" : "option")));
  for (const token of ["--", "-", "+", "-1", "plain", ""]) {
    add(`marker-${JSON.stringify(token)}`, [scan("markers", `token:${token}`, "a1", [token, "-a"], token === "-1" ? "option" : "end"), scan("markers", "again", "a1", [token, "-a"], ["--", "-1"].includes(token) ? "option" : "end")]);
    const fixture = fixtures.at(-1);
    const row = raw.find(row => row.profile === "bash53" && row.id === "markers");
    const lines = row.stdout.split("\n");
    const start = lines.findIndex(line => line.startsWith(`token:${token} rc=`));
    const nextLine = lines[start + 1];
    const next = fixture.operations[1];
    const match = /rc=(\d+) opt=(.*?) I=(.*?) Iset=.*? A=(.*?) Aset=(.*?) E=/u.exec(nextLine);
    next.source.line = nextLine;
    next.source.occurrence = lines.slice(0, start + 1).filter(line => line.startsWith("again rc=")).length;
    next.expected.status = Number(match[1]);
    next.expected.option = unquote(match[2]);
    next.expected.optind = Number(match[3]);
    next.expected.argument = match[5] === "yes" ? { kind: "set", value: unquote(match[4]) } : { kind: "unset" };
  }
  for (const spec of ["a:", ":a:"]) for (const token of ["-a", "-z"]) {
    const kind = token === "-a" ? "missing-argument" : "unknown-option";
    const diagnostic = spec[0] === ":" ? null : token === "-a" ? missing("a") : unknown("z");
    add(`${spec}/${token}`, [scan("missing-silent-errors", `${spec}/${token}`, spec, [token], kind, diagnostic), scan("missing-silent-errors", "end", spec, [token], "end")]);
  }
  for (const token of ["--", "-", "-a", ""]) add(`required-${JSON.stringify(token)}`, [scan("argument-token-values", `arg:${token}`, "a:", ["-a", token])]);
  add("reset-same-visible-one", [scan("same-index-reset", "first", "abc", ["-abc"]), index(1), scan("same-index-reset", "same", "abc", ["-abc"]), scan("same-index-reset", "following", "abc", ["-abc"]), index(1), scan("same-index-reset", "explicitreset", "abc", ["-abc"])]);
  const clustered = ["-a", "-bcd", "-a"];
  add("larger-index-keeps-active-slot", [scan("index-two-midcluster", "first", "abcd", clustered), scan("index-two-midcluster", "second", "abcd", clustered), index(2), scan("index-two-midcluster", "same2", "abcd", clustered), index(3), scan("index-two-midcluster", "jump3", "abcd", clustered)]);
  add("changed-explicit-vector", [scan("changed-argv-cursor", "old", "abcxyz", ["-abc"]), scan("changed-argv-cursor", "new", "abcxyz", ["-xyz"]), scan("changed-argv-cursor", "last", "abcxyz", ["-xyz"])]);
  add("changed-selected-positionals", [scan("set-shift-cursor", "old", "abcxyz", ["-abc", "-xyz"]), scan("set-shift-cursor", "shifted", "abcxyz", ["-xyz"]), scan("set-shift-cursor", "replaced", "abcxyz", ["-abc"])]);
  add("shorter-active-token", [scan("argv-shorter-than-cursor", "a", "abcxyz", ["-abc"]), scan("argv-shorter-than-cursor", "shorter", "abcxyz", ["-x"]), scan("argv-shorter-than-cursor", "end", "abcxyz", ["-x"], "end")]);
  const jumpArgs = ["-abc", "-xyz", "-d"];
  add("active-slot-independent-from-index", [scan("jump-keeps-active-slot", "a", "abcdxyz", jumpArgs), index(2), scan("jump-keeps-active-slot", "jump", "abcdxyz", jumpArgs), scan("jump-keeps-active-slot", "c", "abcdxyz", jumpArgs), scan("jump-keeps-active-slot", "next", "abcdxyz", jumpArgs)]);
  add("bounded-long-token", [scan("long-bounded", "first", `${"b".repeat(4096)}a`, [`-${"a".repeat(4096)}`]), scan("long-bounded", "next", "a", [`-${"a".repeat(4096)}`])]);
  for (const value of ["0", "1", "2", "-1", "", "word", "00", "1+1", "unset"]) {
    const reportErrors = !["0", "word", "00"].includes(value);
    add(`resolved-opterr-${JSON.stringify(value)}`, [scan("opterr-marked", value, "a", ["-z"], "unknown-option", reportErrors ? unknown("z") : null, reportErrors)]);
  }
  for (const value of [0, -1, 2, 99]) {
    const caseId = `index-value-${value}`;
    add(`numeric-index-primitive-${value}`, [scan(caseId, "first", "abc", ["-abc", "-b"]), index(value), scan(caseId, "next", "abc", ["-abc", "-b"], value === 99 ? "end" : "option"), scan(caseId, "again", "abc", ["-abc", "-b"], value === 99 ? "end" : "option")]);
  }
  const selected = new Set(fixtures.flatMap(fixture => fixture.operations.filter(operation => operation.operation === "scan").map(operation => operation.source.caseId)));
  const reasons = {
    "usage-invalidnames": "Builtin usage/name binding, not scanner input validation.",
    "optionstring-edges": "Mixed builtin operand parsing and scanner cases; retained, not counted in this cohort.",
    "utf8-byte-profile": "Native non-ASCII byte options intentionally refused by the approved profile.",
    "errexit-end": "Runtime errexit behavior, not pure scan result.",
    "readonly-optarg": "Native readonly removal conflicts with stronger root policy; deferred binding divergence.",
    "readonly-optarg-set-first": "Native readonly removal conflicts with stronger root policy; deferred binding divergence.",
  };
  const excluded = raw.filter(row => row.profile === "bash53" && !selected.has(row.id)).map(row => ({ caseId: row.id, rawFile: row.rawFile, reason: reasons[row.id] ?? "Variable coercion/binding, readonly ordering, function or shell execution scope; stage 2, not helper acceptance." }));
  return { format: "frozen-getopts-scanner-facts-v1", target: "Bash 5.3.0(1)-release Darwin C locale; scanner projections only", nativeCaseInvocations: raw.length, scriptsPerProfile: raw.length / 2, historicalProfile: "All Bash3.2 raw observations retained, none counted as helper expectations", selectedNativeScriptCases: selected.size, projectedScanObservations: fixtures.reduce((sum, fixture) => sum + fixture.operations.filter(operation => operation.operation === "scan").length, 0), phase2Notice: "Numeric index events and resolved reportErrors are explicit helper inputs, NOT proof of assignment/OPTERR runtime hooks", fixtures, excluded };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--stdout")) console.log(JSON.stringify(buildFrozenCohort(), null, 2));
