export const expanded = Object.freeze({ startupMs: 15000, guestMs: 5000, requestMs: 10000, totalMs: 28000, settleMs: 1000, snapshotMs: 1000, disposeMs: 1000, naturalMs: 1000, termMs: 1000, killMs: 1000, outputBytes: 4194304, diagnosticBytes: 65536, reportBytes: 67108864, events: 4096, snapshotBytes: 33554432, entries: 4096, depth: 32 });
export function limitsFor(profile, specimen) {
  if (profile !== 'breadth') return { ...expanded };
  const optional = ['javascript', 'python', 'sqlite'].includes(specimen.configuration);
  return { ...expanded, guestMs: optional ? 120000 : 30000, totalMs: optional ? 140000 : 50000, requestMs: optional ? 140000 : 50000, settleMs: 10000, snapshotMs: 10000, disposeMs: 10000, naturalMs: 10000 };
}
export const sentinelLimits = Object.freeze({ ...expanded, startupMs: 2000, guestMs: 180, requestMs: 1400, totalMs: 4500, settleMs: 150, snapshotMs: 200, disposeMs: 200, naturalMs: 180, termMs: 120, killMs: 200, reportBytes: 131072, diagnosticBytes: 4096, events: 64 });
