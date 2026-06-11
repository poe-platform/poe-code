export function adversarialFailure(input: {
  cause: unknown;
  kind: "source" | "snapshot";
  seed: number;
  value: string;
}): Error {
  const detail =
    input.cause instanceof Error
      ? `${input.cause.name}: ${input.cause.message}`
      : String(input.cause);
  return new Error(
    [
      `Adversarial ${input.kind} case failed.`,
      `seed=0x${input.seed.toString(16)}`,
      `minimized ${input.kind}:`,
      compact(input.value),
      `cause: ${detail}`
    ].join("\n")
  );
}

export function minimizeSource(source: string, stillFails: (candidate: string) => boolean): string {
  return minimizeParts(source, stillFails, "\n");
}

export function minimizeSnapshot(
  snapshot: Record<string, unknown>,
  stillFails: (candidate: Record<string, unknown>) => boolean
): string {
  const candidate = structuredClone(snapshot);
  for (const key of Object.keys(candidate)) {
    const next = structuredClone(candidate);
    delete next[key];
    if (stillFails(next)) delete candidate[key];
  }
  return JSON.stringify(candidate);
}

function minimizeParts(
  value: string,
  stillFails: (candidate: string) => boolean,
  separator: string
): string {
  let parts = value.split(separator);
  let chunkSize = Math.ceil(parts.length / 2);
  while (chunkSize > 0 && parts.length > 1) {
    let reduced = false;
    for (let start = 0; start < parts.length; start += chunkSize) {
      const candidate = parts.slice(0, start).concat(parts.slice(start + chunkSize));
      const joined = candidate.join(separator);
      if (candidate.length > 0 && stillFails(joined)) {
        parts = candidate;
        reduced = true;
        break;
      }
    }
    if (!reduced) chunkSize = Math.floor(chunkSize / 2);
  }
  return parts.join(separator);
}

function compact(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 500 ? compact : `${compact.slice(0, 500)}…`;
}
