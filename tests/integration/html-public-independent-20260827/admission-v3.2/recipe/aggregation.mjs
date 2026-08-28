export function safetyGate(proof) {
  const required = ["bindingsIntact", "receiptPresent", "numericReceiptPresent", "closeObserved", "reaped", "groupEmpty", "cleanupComplete"];
  const missing = required.filter(field => proof?.[field] !== true);
  return { safe: missing.length === 0, missing, proof };
}

export async function runIndependent(cases, execute) {
  const rows = [];
  for (const control of cases) {
    const row = await execute(control, rows.length + 1);
    rows.push(row);
    if (row.safety?.safe !== true) break;
  }
  const unexecuted = cases.slice(rows.length);
  return { rows, unexecuted, exitCode: rows.some(row => row.outcome !== "expected-control-outcome" || row.safety?.safe !== true) || unexecuted.length ? 1 : 0 };
}

export function orderedPredicate(record) {
  const expected = { timeout: "V3_TIMEOUT", "allocation-mutant": "V3_RSS_LIMIT" }[record.control];
  const consumer = record.consumer?.value, producer = record.producer?.value;
  const ordering = consumer?.orderedObservation;
  const sequence = type => ordering?.events.find(event => event.type === type)?.sequence;
  const stages = ["stop-request", "producer-exit", "owned-pipe-destroy", "producer-close", "throw-original", "core-settled"].map(sequence);
  return Boolean(expected && consumer?.failure?.code === expected && record.forwardedFailureCode === expected
    && consumer.failure.message === `CONTROL_BOUNDARY:${expected}` && record.forwardedFailureMessage === consumer.failure.message
    && producer?.signal === "SIGTERM" && producer.status === null
    && consumer.failure.process?.signal === "SIGTERM" && consumer.failure.process.status === null
    && ordering?.completed === true && ordering.error === null && ordering.sameFailureObject === true && ordering.signalAccepted === true
    && ordering.exit?.status === null && ordering.exit.signal === "SIGTERM" && ordering.close?.status === null && ordering.close.signal === "SIGTERM"
    && ordering.events.find(event => event.type === "producer-exit")?.pipeDestroyed === false
    && stages.every((value, index) => Number.isInteger(value) && (index === 0 || value > stages[index - 1])));
}
