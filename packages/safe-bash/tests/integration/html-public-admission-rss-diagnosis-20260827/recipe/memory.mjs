export function memoryObserver() {
  const keys = ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"];
  const peak = Object.fromEntries(keys.map(key => [key, 0]));
  const phases = [];
  let samples = 0;
  function sample(phase) {
    const current = process.memoryUsage();
    samples++;
    for (const key of keys) peak[key] = Math.max(peak[key], current[key]);
    if (phase) phases.push({ phase, at: new Date().toISOString(), ...current });
    return current;
  }
  return { sample, report: () => ({ units: "bytes", pid: process.pid, samples, peak, phases, scope: "current process only; sampled fieldwise maxima need not coincide; not a lifetime RSS high-water or a process-tree sum" }) };
}
