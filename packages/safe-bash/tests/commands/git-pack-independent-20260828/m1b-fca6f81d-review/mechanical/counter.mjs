import { openSession, observeReservations } from "./session-observation.mjs";

export async function runCase(api, caseId) {
  if (!["COUNTER-pristine", "COUNTER-mutant", "COUNTER-restored"].includes(caseId)) throw new Error("Unknown counter case");
  const observed = await openSession(api);
  const ledger = observeReservations(observed.session);
  api.registerCleanup(() => ledger.restore());
  const body = observed.session.allocate(7);
  observed.session.release(body);
  observed.session.release(body);
  const events = ledger.events.map(event => ({ ...event }));
  const unreserved = events.filter(event => event.event === "unreserve");
  const reserves = events.filter(event => event.event === "reserve-return");
  const originalPredicate = unreserved.length === 1 && unreserved[0].size === 7;
  ledger.restore();
  const cleanup = await observed.closeObservation();
  await api.capture("counter-outcome", {
    caseId, events, originalPredicate, cleanupFailed: cleanup.failed,
    scope: "Actual private Session.release -> delegated unreserve calls; no private counter read/write, no RSS or public cap proof",
  });
  api.check("cleanup", !cleanup.failed);
  api.check("one-actual-reservation", reserves.length === 1 && reserves[0].size === 7);
  api.check("loaded-counter-distinction", caseId === "COUNTER-mutant" ? unreserved.length === 0 && !originalPredicate : originalPredicate);
}
