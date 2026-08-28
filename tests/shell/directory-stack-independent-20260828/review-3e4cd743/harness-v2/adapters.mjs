import assert from "node:assert/strict";

export const gaps = {
  L01: "4096-entry public setup admission and count-before-missing-OLDPWD witness not implemented; no private State injection",
  L02: "4095-entry public setup, exact cumulative output/command accounting not implemented",
  L13: "oversize initial cwd and seed publication despite display failure require separately presealed truthful scripted provider",
  L14: "4MiB public tail construction/reachability through possible work failures not implemented",
  L15: "exact4194303-byte public seed and inserted-cwd pre-admission witness not implemented",
  L16: "four grouped inert-family schedules against readonly bindings and throwing-on-all-methods host require dedicated adapter",
  C02: "stat-admission/abort/late-rejection barrier and exact reason witness not yet integrated with actual Shell",
  C03: "pre-abort public observation of pre-cd tail publication requires separately bound observation schedule; no getter",
  C04: "required-print abort with separately enrolled cooperative owner and settlement trace not integrated",
  C05: "registered cleanup failure/root-abort-before-settlement schedule not integrated",
  C06: "equal-valued root/escaping/local provenance and concurrent sibling schedules require versioned host adapter",
  C10: "destination-owned stdout close versus separately owned file/header/stderr scopes requires versioned enrollment fixture",
  C12: "public scheduling witness does not identify exact private work/final-flush boundary; source I08 or presealed instrumentation",
  A04: "exact accepted-CD+LET independently declared public keys/default registry inventory not supplied"
};
export const sourceKeys = {
  rawTarget: "I17", stackCwdPublication: "I05", noStackCwdPublication: "I05", sameForwardedPathPreserved: "I06",
  laterOrdinaryCdCannotEraseStackStamp: "I06", ordinaryCdOnlyRestorationUnchanged: "I06", childStampCannotPreserveBorrowedParentCwd: "I06",
  noLaterExports: "I17", tailInsertion: "I17", tailRemoval: "I17", automaticDisplay: "I17", rollback: "I17",
  tailBytes: "I07", originalRawStringRetained: "I07", unusedHomeNotScanned: "I10", ignoredArgumentNotScanned: "I10",
  publishedFull: "I17", noNewPrivateLimitKey: "I22", noReset: "I19", noHiddenCdDispatchTick: "I19", sharedBudgetMonotonic: "I19",
  registryInventoryUnchanged: "I22", literalArgv: "I21", noStackPublication: "I17"
};
export const dynamicKeys = new Set(["status", "full", "stdout", "PWD", "OLDPWD", "unchanged", "calls", "realCd", "envUnchanged", "diagnostic", "diagnosticPayload", "readonlyRetained", "parentFull", "subjectFull", "subjectStdout", "secondStdout", "freshTail", "firstFinalFull", "noCrossWriteback", "childStdout", "noSiblingWriteback", "entryEnvExact", "accessCalls", "fallbackCalls", "diagnosticPreservesCodeMeaningAndPath", "callOrder", "stdoutRecipe", "allChunksAtMost", "noSplitSurrogatePairs", "rejectExactReason", "noStackPublication", "rejectClass", "limit", "maxPendingWrites", "pendingWriteBytesUnchanged", "ownedSnapshotsExact", "bytesExact", "acceptedPrefixRetained", "noFurtherWrites", "noRollback", "allThreeGenuineBuiltins"]);
export function describeCase(row) {
  const unhandled = Object.keys(row.expect).filter((key) => !dynamicKeys.has(key) && !sourceKeys[key] && key !== "qualification");
  const gap = gaps[row.id] ?? (unhandled.length ? `unimplemented expected fields: ${unhandled.join(",")}` : null);
  return { id: row.id, status: gap ? "bounded-adapter-gap" : "adapter-prepared-unexecuted", route: gap ? null : ["S02", "S03"].includes(row.id) ? "fresh-execs" : ["C01", "C09", "C11"].includes(row.id) ? "direct-boundary" : "same-exec-public", sourceOnly: Object.fromEntries(Object.keys(row.expect).filter((key) => sourceKeys[key]).map((key) => [key, sourceKeys[key]])), gap };
}
export function expand(value) {
  if (typeof value === "string") return value;
  assert(value && typeof value.repeat === "string" && Number.isInteger(value.count) && value.count >= 0 && value.count <= 65537);
  return value.repeat.repeat(value.count);
}
export function quote(value) {
  assert.equal(typeof value, "string");
  assert(!value.includes("\0"), "literal shell source cannot carry NUL");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function inputFor(row) {
  assert(!gaps[row.id], gaps[row.id]);
  const full = row.full ?? (row.id === "D10" ? ["/c", ...Array(100).fill("x")] : ["C07", "C08"].includes(row.id) ? ["/c", "x".repeat(65536)] : ["/c"]);
  const env = { PWD: "/c", OLDPWD: "/old", ...row.env, ...Object.fromEntries(Object.entries(row.envRecipe ?? {}).map(([name, value]) => [name, expand(value)])) };
  const argv = row.argv ?? row.argvRecipe?.map(expand);
  const middlewareScripts = { M01: "pushd -n /a", M02: "dirs", M03: "f() { command pushd /b; }; f", M04: "f() { pushd /a; cd /b; }; f", M05: "f() { cd /b; }; f", M06: "f() { pushd /a; }; f", M07: "f() { pushd /a; }; f", M08: "f() { __ds_child; }; f" };
  const setup = row.setup ?? (row.id === "M06" ? "readonly PWD" : row.id === "M07" ? "readonly OLDPWD" : "");
  const subject = ["S10", "S11", "L06", "A03"].includes(row.id) ? "__ds_child" : middlewareScripts[row.id] ?? row.script ?? (argv ? argv.map(quote).join(" ") : ["C07", "C08"].includes(row.id) ? "dirs -l" : null);
  assert(subject, `no subject adapter ${row.id}`);
  return { full, env, argv, setup, subject };
}
export function programFor(row) {
  const input = inputFor(row);
  const commands = ["__ds_phase setup"];
  for (const entry of input.full.slice(1).reverse()) commands.push(`pushd -n -- ${quote(entry)}`, '__ds_seed "$?" || exit 97');
  if (row.id === "L09") commands.push("__ds_phase initialProbe", "dirs -l -p");
  if (input.setup) commands.push(input.setup, '__ds_seed "$?" || exit 97');
  commands.push("__ds_phase readonlyBefore", "readonly -p", '__ds_seed "$?" || exit 97', "__ds_phase before", "__ds_phase subject", input.subject, '__ds_status "$?"', "__ds_phase probe", "dirs -l -p", '__ds_probe_status "$?"', "__ds_phase readonlyAfter", "readonly -p", '__ds_seed "$?" || exit 97', "__ds_phase after");
  return { ...input, source: commands.join("\n") };
}
