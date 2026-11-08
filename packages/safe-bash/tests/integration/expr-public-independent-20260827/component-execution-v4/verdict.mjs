export const contextIds = ["installed-node22", "installed-node24", "moved-node22", "moved-node24"];
export const packageIds = ["ordinary", "held-release", "held-withhold", "root-negative", "subpath-negative", "subpath-restored", "source-fallback", "worker-negative", "worker-restored"];
export const typeIds = ["positive", "negative", "N01", "N02", "N03", "N04", "N05", "N06", "combined", "broken-declaration"];
export const runtimeIds = Array.from({ length: 26 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`);
export const aggregateControls = ["positive", "failed-P01", "missing-P01", "missing-admission", "missing-repair", "failed-repair", "missing-controls", "failed-control", "missing-types", "failed-type", "unrun-case", "missing-context", "missing-finalization", "failed-finalization", "failed-check", "unclosed-child", "integrity-held"];
export const repairControlCount = 28;

export function verdict({ report, admission, repair, finalization }) {
  const reasons = [];
  const require = (condition, reason) => { if (!condition) reasons.push(reason); };
  require(admission?.status === "qualified" && admission?.allChildrenClosed === true, "reader-admission");
  require(repair?.status === "qualified" && repair?.pass === repairControlCount && repair?.planned === repairControlCount, "repair-controls");
  require(report?.P01?.status === "pass", "P01");
  require(report?.fixture?.status === "authenticated", "fixture-binding");
  require(report?.allProcessChildrenClosed === true && report?.commands?.length > 0 && report.commands.every(row => row.closed === true && row.naturalSettlement === true), "child-closure");
  require(report?.integrityHeld === undefined, "integrity-hold");
  require(Array.isArray(report?.failures) && report.failures.length === 0, "reported-failures");
  require(report?.checks?.length > 0 && report.checks.every(row => row.status === "pass"), "integrity-checks");
  require(finalization?.status === "pass", "finalization");
  const contexts = report?.contexts ?? [];
  require(contexts.length === contextIds.length && new Set(contexts.map(row => row.label)).size === contextIds.length, "context-count");
  const complete = (rows, ids, executed) => Array.isArray(rows) && rows.length === ids.length && ids.every(id => rows.filter(row => row.id === id && row.status === "pass" && (!executed || row.executed === true)).length === 1);
  for (const label of contextIds) {
    const state = contexts.find(row => row.label === label);
    require(complete(state?.controls, packageIds, false), `${label}:package-controls`);
    require(complete(state?.types, typeIds, true), `${label}:types`);
    require(complete(state?.cases, runtimeIds, true), `${label}:runtime`);
  }
  return { status: reasons.length ? "HELD" : "PASS component-only", exitCode: reasons.length ? 1 : 0, reasons };
}

export function syntheticState(id) {
  const state = {
    admission: { status: "qualified", allChildrenClosed: true },
    repair: { status: "qualified", pass: repairControlCount, planned: repairControlCount },
    finalization: { status: "pass" },
    report: { P01: { status: "pass" }, fixture: { status: "authenticated" }, failures: [], checks: [{ status: "pass" }], allProcessChildrenClosed: true,
      commands: [{ status: 0, closed: true, naturalSettlement: true }], outerExit: 0,
      contexts: contextIds.map(label => ({ label, controls: packageIds.map(id => ({ id, status: "pass" })), types: typeIds.map(id => ({ id, status: "pass", executed: true })), cases: runtimeIds.map(id => ({ id, status: "pass", executed: true })) })) },
  };
  if (id === "failed-P01") state.report.P01.status = "fail";
  else if (id === "missing-P01") delete state.report.P01;
  else if (id === "missing-admission") delete state.admission;
  else if (id === "missing-repair") delete state.repair;
  else if (id === "failed-repair") state.repair.status = "HELD";
  else if (id === "missing-controls") state.report.contexts[0].controls = [];
  else if (id === "failed-control") state.report.contexts[0].controls[0].status = "fail";
  else if (id === "missing-types") state.report.contexts[0].types = [];
  else if (id === "failed-type") state.report.contexts[0].types[0].status = "fail";
  else if (id === "unrun-case") state.report.contexts[0].cases[0] = { id: "R01", status: "unrun", executed: false };
  else if (id === "missing-context") state.report.contexts.pop();
  else if (id === "missing-finalization") delete state.finalization;
  else if (id === "failed-finalization") state.finalization.status = "fail";
  else if (id === "failed-check") state.report.checks[0].status = "fail";
  else if (id === "unclosed-child") state.report.commands[0].closed = false;
  else if (id === "integrity-held") state.report.integrityHeld = "synthetic binding failure";
  else if (id !== "positive") throw new Error(`Unknown aggregate control: ${id}`);
  return state;
}
