export function formatElapsed(ms: number): string {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  const totalSeconds = Math.max(0, Math.floor(safeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
}
