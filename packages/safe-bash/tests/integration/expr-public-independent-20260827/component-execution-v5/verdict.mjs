export const contextIds = ["installed-node22", "installed-node24", "moved-node22", "moved-node24"];
export const packageIds = ["ordinary", "held-release", "held-withhold", "root-negative", "subpath-negative", "subpath-restored", "source-fallback", "worker-negative", "worker-restored"];
export const typeIds = ["positive", "negative", "N01", "N02", "N03", "N04", "N05", "N06", "combined", "broken-declaration"];
export const runtimeIds = Array.from({ length: 26 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`);
export const aggregateControls = ["positive", "failed-P01", "missing-P01", "missing-admission", "missing-repair", "failed-repair", "missing-controls", "failed-control", "missing-types", "failed-type", "unrun-case", "missing-context", "missing-finalization", "failed-finalization", "failed-check", "unclosed-child", "integrity-held", "missing-bound-proof", "failed-trace-control", "missing-trace-control", "supervised-type", "missing-phase"];
export const repairControlCount = 28;
export const newControlCount = 16 + aggregateControls.length;

export function verdict({ report, admission, repair, traceControls, finalization }) {
  const reasons = [];
  const require = (condition, reason) => { if (!condition) reasons.push(reason); };
  require(admission?.status === "qualified-evidence-reused" && admission?.controls === 16 && admission?.newControls === 0, "reader-admission");
  require(repair?.status === "qualified-evidence-reused" && repair?.pass === repairControlCount && repair?.planned === repairControlCount, "repair-controls");
  require(report?.P01?.status === "BOUND_ACCEPTED_PROOF" && report.P01.accepted === true && report.P01.independentlyBuiltIn === "1ec1912001db43f803af46bb5dea89a7e397b83b" && report.P01.actualPackSha256 === "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd" && report.P01.independentInputsBound === 357 && report.P01.buildExecuted === false, "P01-bound-accepted-proof");
  require(traceControls?.status === "qualified" && traceControls?.pass === newControlCount && traceControls?.planned === newControlCount, "trace-controls");
  require(report?.fixture?.status === "authenticated", "fixture-binding");
  require(report?.allProcessChildrenClosed === true && report?.commands?.length > 0 && report.commands.every(row => row.closed === true), "child-closure");
  require(report?.commands?.every(row => row.naturalSettlement === true || row.expectedSupervision === true), "unexpected-supervision");
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
    require(JSON.stringify(state?.phaseOrder) === JSON.stringify(["package", "runtime", "types"]), `${label}:phase-order`);
  }
  return { status: reasons.length ? "HELD" : "PASS component-only", exitCode: reasons.length ? 1 : 0, reasons };
}

export function syntheticState(id) {
  const state = {
    admission: { status: "qualified-evidence-reused", controls: 16, newControls: 0 },
    repair: { status: "qualified-evidence-reused", pass: repairControlCount, planned: repairControlCount },
    traceControls: { status: "qualified", pass: newControlCount, planned: newControlCount },
    finalization: { status: "pass" },
    report: { P01: { status: "BOUND_ACCEPTED_PROOF", accepted: true, independentlyBuiltIn: "1ec1912001db43f803af46bb5dea89a7e397b83b", actualPackSha256: "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd", independentInputsBound: 357, buildExecuted: false }, fixture: { status: "authenticated" }, failures: [], checks: [{ status: "pass" }], allProcessChildrenClosed: true,
      commands: [{ status: 0, closed: true, naturalSettlement: true }], outerExit: 0,
      contexts: contextIds.map(label => ({ label, phaseOrder: ["package", "runtime", "types"], controls: packageIds.map(id => ({ id, status: "pass" })), types: typeIds.map(id => ({ id, status: "pass", executed: true })), cases: runtimeIds.map(id => ({ id, status: "pass", executed: true })) })) },
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
  else if (id === "missing-bound-proof") delete state.report.P01.independentlyBuiltIn;
  else if (id === "failed-trace-control") state.traceControls.pass--;
  else if (id === "missing-trace-control") delete state.traceControls;
  else if (id === "supervised-type") { state.report.commands[0].naturalSettlement = false; state.report.contexts[0].types[0].status = "fail"; }
  else if (id === "missing-phase") state.report.contexts[0].phaseOrder.pop();
  else if (id !== "positive") throw new Error(`Unknown aggregate control: ${id}`);
  return state;
}
