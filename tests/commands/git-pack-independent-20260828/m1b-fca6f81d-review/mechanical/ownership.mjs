import { Buffer } from "node:buffer";
import { indexFixture } from "./fixture-data.mjs";
import { openSession, observeReservations, reasonFacts } from "./session-observation.mjs";

const profiles = new Map([
  ["S01-reserve-error", ["reserve", "error"]],
  ["S01-reserve-null", ["reserve", "null"]],
  ["S01-reserve-undefined", ["reserve", "undefined"]],
  ["S01-allocate-error", ["allocate", "error"]],
  ["S01-allocate-null", ["allocate", "null"]],
  ["S01-allocate-undefined", ["allocate", "undefined"]],
  ["S01-first-reserve", ["first", "error"]],
  ["S01-late-step", ["step", "error"]],
  ["S01-success", ["none", "error"]],
  ["S01-pristine", ["reserve", "error"]],
  ["S01-reverted", ["reserve", "error"]],
  ["S01-restored", ["reserve", "error"]],
]);

export async function runCase(api, caseId) {
  const profile = profiles.get(caseId);
  if (!profile) throw new Error("Unknown ownership case");
  const [site, reasonKind] = profile;
  const injected = reasonKind === "null" ? null : reasonKind === "undefined" ? undefined : new Error("independent-S01-sentinel");
  const observed = await openSession(api);
  const { session } = observed;
  const ledger = observeReservations(session);
  let restored = false;
  const restore = () => {
    if (!restored) {
      if (stepDescriptor === undefined) delete session.step;
      else Object.defineProperty(session, "step", stepDescriptor);
      ledger.restore();
      restored = true;
    }
  };
  api.registerCleanup(restore);
  const reserve = session.reserve;
  const allocate = session.allocate;
  const step = session.step;
  const stepDescriptor = Object.getOwnPropertyDescriptor(session, "step");
  const bufferDescriptor = Object.getOwnPropertyDescriptor(Buffer, "alloc");
  let fired = 0;
  let bufferRestored = true;
  session.reserve = function (size) {
    if (site === "reserve" && size === 1024 || site === "first" && size === 1) { fired++; throw injected; }
    return Reflect.apply(reserve, this, [size]);
  };
  session.allocate = function (size) {
    if (site !== "allocate" || size !== 1024) return Reflect.apply(allocate, this, [size]);
    if (!bufferDescriptor || !Object.hasOwn(bufferDescriptor, "value") || typeof bufferDescriptor.value !== "function" || !bufferDescriptor.configurable) throw new Error("Buffer.alloc descriptor not admitted");
    bufferRestored = false;
    Object.defineProperty(Buffer, "alloc", { ...bufferDescriptor, value: function (...args) {
      if (args.length !== 1 || args[0] !== 1024) throw new Error("Unexpected synchronous allocation route");
      fired++;
      throw injected;
    } });
    try { return Reflect.apply(allocate, this, [size]); }
    finally { Object.defineProperty(Buffer, "alloc", bufferDescriptor); bufferRestored = true; }
  };
  if (site === "step") session.step = async function (amount) {
    if (amount === 40) { fired++; throw injected; }
    return Reflect.apply(step, this, [amount]);
  };
  const { PackCatalogue } = await api.load("dist/commands/git/pack.js");
  const catalogue = new PackCatalogue(session);
  const method = Object.getOwnPropertyDescriptor(PackCatalogue.prototype, "index");
  if (!method || !Object.hasOwn(method, "value") || typeof method.value !== "function") throw new Error("Private index entry is not the pinned emitted method");
  const fixture = indexFixture();
  await api.captureBytes("index-input", fixture.index);
  await api.captureBytes("pack-header-input", fixture.pack);
  let failed = false;
  let failure;
  let rows;
  try { rows = await Reflect.apply(method.value, catalogue, [fixture.index, fixture.pack]); }
  catch (error) { failed = true; failure = error; }
  finally {
    if (stepDescriptor === undefined) delete session.step;
    else Object.defineProperty(session, "step", stepDescriptor);
  }
  const events = ledger.events.map(event => ({ ...event }));
  const slots = events.find(event => event.event === "allocate-return" && event.size === 1);
  const buckets = events.find(event => event.event === "allocate-return" && event.size === 1024);
  const releases = acquired => acquired ? events.filter(event => event.event === "release" && event.owner === acquired.owner).length : 0;
  const slotReleases = releases(slots);
  const bucketReleases = releases(buckets);
  const unreserved = events.filter(event => event.event === "unreserve").map(event => event.size);
  restore();
  const cleanup = await observed.closeObservation();
  const raw = {
    caseId, proofRole: "PRIVATE_INSTANCE_LOGICAL_OWNERSHIP_NOT_NATIVE_ALLOCATION_FAILURE",
    reason: reasonFacts(failed, failure, injected), fired, events, slotReleases, bucketReleases,
    unreserved, rows: Array.isArray(rows) ? rows.length : null, bufferRestored, restored,
    cleanupFailed: cleanup.failed, cleanupCalls: cleanup.cleanupCalls, registeredHooks: cleanup.registeredHooks,
    invariantSatisfied: site === "first" ? slots === undefined : slotReleases === 1,
  };
  await api.capture("ownership-outcome", raw);
  api.check("cleanup-and-restoration", !cleanup.failed && restored && bufferRestored && cleanup.registeredHooks === 1);
  api.check("injection-route", fired === (site === "none" ? 0 : 1));
  api.check("reason-or-success", site === "none" ? !failed && rows?.length === 2 : failed && Object.is(failure, injected));
  api.check("slot-unwind", caseId === "S01-reverted" ? slotReleases === 0 && slots !== undefined : raw.invariantSatisfied);
  api.check("bucket-ownership", bucketReleases === (site === "none" || site === "step" ? 1 : 0));
  api.check("actual-reservation-unwind", caseId === "S01-reverted" ? unreserved.length === 0 :
    site === "first" ? unreserved.length === 0 :
    site === "allocate" ? unreserved.length === 2 && unreserved[0] === 1024 && unreserved[1] === 1 :
    site === "none" || site === "step" ? unreserved.length === 2 && unreserved[0] === 1 && unreserved[1] === 1024 :
    unreserved.length === 1 && unreserved[0] === 1);
}
