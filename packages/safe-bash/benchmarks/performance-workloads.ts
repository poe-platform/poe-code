import { textBytes, type BenchmarkCase } from "./model.js";

function workload(name: string, script: string, stdin: string | Uint8Array, stdout: string | Uint8Array, files: Record<string, string> = {}): BenchmarkCase {
  return { name, tier: "performance-pilot", tags: [name.split("-")[0]!], source: "deterministic", script,
    stdin: Buffer.from(stdin).toString("base64"), initialFiles: {}, env: {},
    expected: { stdout: Buffer.from(stdout).toString("base64"), stderr: "", exitCode: 0, files } };
}

export function performanceWorkloads(): BenchmarkCase[] {
  const workloads: BenchmarkCase[] = [];
  for (const records of [128, 2048, 16384]) {
    const input = Array.from({ length: records }, (_, index) => `keep:value-${index % 31}\n`).join("");
    const expected = input.replaceAll("keep:", "");
    workloads.push(workload(`sed-${records}-records`, "sed 's/^keep://'", input, expected));
    const numbers = Array.from({ length: records }, (_, index) => index % 13);
    workloads.push(workload(`awk-${records}-records`, "awk '{sum+=$2} END{print NR,sum}'", numbers.map(value => `value ${value}\n`).join(""), `${records} ${numbers.reduce((sum, value) => sum + value, 0)}\n`));
  }
  for (const size of [128 * 1024, 1024 * 1024]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 256);
    workloads.push(workload(`bytes-${size}`, "cat | tee output | cat", bytes, bytes, { output: Buffer.from(bytes).toString("base64") }));
  }
  for (const records of [1024, 8192]) {
    const input = Array.from({ length: records }, (_, index) => `${index % 3 ? "keep" : "skip"}:value-${index % 31}\n`).join("");
    const expected = [...new Set(input.trimEnd().split("\n").filter(line => line.startsWith("keep:")).map(line => line.slice(5)))].sort().join("\n") + "\n";
    workloads.push(workload(`pipeline-${records}-records`, "grep '^keep:' | cut -d : -f 2 | sort | uniq | tee output", input, expected, { output: textBytes(expected) }));
  }
  for (const count of [16, 128]) {
    const files = Object.fromEntries(Array.from({ length: count }, (_, index) => [`file-${index}`, textBytes(`value-${index}\n`)]));
    const script = Array.from({ length: count }, (_, index) => `printf 'value-${index}\\n' > file-${index}`).join(";");
    workloads.push(workload(`filesystem-${count}-writes`, script, "", "", files));
  }
  return workloads;
}

export function latencySummary(samples: readonly number[]): { count: number; minMs: number; medianMs: number; p95Ms: number; maxMs: number } {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError("Latency samples must be nonempty finite nonnegative numbers");
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, minMs: sorted[0]!, medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1]!, maxMs: sorted.at(-1)! };
}
