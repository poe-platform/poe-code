/** Evidence comparisons never normalize, sort, or discard observable fields. */
export interface NamespaceEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly mode: number;
  readonly bytes?: readonly number[];
  readonly target?: string;
}
export interface Capture {
  readonly sourceHash: string;
  readonly profileHash: string;
  readonly inputHash: string;
  readonly argv0?: readonly number[];
  readonly argv: readonly (readonly number[])[];
  readonly stdin: readonly number[];
  readonly env: readonly (readonly [string, string])[];
  readonly cwd: string;
  readonly status: number;
  readonly stdout: readonly number[];
  readonly stderr: readonly number[];
  readonly before: NamespaceEntry[];
  readonly after: NamespaceEntry[];
}
export function compareCapture(reference: Capture, candidate: Capture): string[] {
  const fields: (keyof Capture)[] = ["sourceHash", "profileHash", "inputHash", "argv", "stdin", "env", "cwd", "status", "stdout", "stderr", "before", "after"];
  if (Object.hasOwn(reference ?? {}, "argv0") || Object.hasOwn(candidate ?? {}, "argv0")) fields.push("argv0");
  const bytes = (value: unknown): boolean => Array.isArray(value) && Array.from(value).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  const valid = (field: keyof Capture, value: unknown): boolean => {
    if (["sourceHash", "profileHash", "inputHash", "cwd"].includes(field)) return typeof value === "string" && value.length > 0;
    if (field === "status") return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;
    if (field === "argv0") return bytes(value) && (value as readonly number[]).length > 0 && !(value as readonly number[]).includes(0);
    if (field === "stdin" || field === "stdout" || field === "stderr") return bytes(value);
    if (field === "argv") return Array.isArray(value) && Array.from(value).every(bytes);
    if (field === "env") {
      const keys = new Set<string>();
      return Array.isArray(value) && Array.from(value).every(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
          !pair[0].length || pair[0].includes("=") || pair[0].includes("\0") || pair[1].includes("\0") || keys.has(pair[0])) return false;
        keys.add(pair[0]);
        return true;
      });
    }
    const paths = new Set<string>();
    return Array.isArray(value) && Array.from(value).every(entry => {
      if (entry === null || typeof entry !== "object" || typeof entry.path !== "string" || !entry.path.length ||
        entry.path.includes("\0") || paths.has(entry.path) || !Number.isSafeInteger(entry.mode) || entry.mode < 0 ||
        !(entry.kind === "directory" || entry.kind === "file" && bytes(entry.bytes) || entry.kind === "symlink" &&
          typeof entry.target === "string" && entry.target.length > 0 && !entry.target.includes("\0"))) return false;
      paths.add(entry.path);
      return true;
    });
  };
  return fields.filter(field => !valid(field, reference?.[field]) || !valid(field, candidate?.[field]) ||
    JSON.stringify(reference[field]) !== JSON.stringify(candidate[field]));
}
export interface Evidence {
  readonly feature: string;
  readonly state: "passed" | "blocked" | "mismatched";
  readonly reason?: string;
  readonly exact?: boolean;
  readonly structured?: boolean;
  readonly semantic?: boolean;
  readonly roundTrip?: boolean;
  readonly interoperability?: boolean;
  readonly receipts?: {
    readonly sourceHash: string;
    readonly profileHash: string;
    readonly inputHash: string;
    readonly referenceHash: string;
    readonly candidateHash: string;
  };
  readonly checks?: Readonly<Record<string, boolean>>;
}
export interface Feature {
  readonly id: string;
  readonly requirements: readonly string[];
}
export function coverageGate(features: readonly (string | Feature)[], evidence: readonly Evidence[]) {
  const ids = features.map(feature => typeof feature === "string" ? feature : feature.id);
  const expected = new Set(ids);
  if (expected.size !== features.length) throw new Error("Duplicate feature denominator");
  const measured = new Map<string, Evidence>();
  for (const entry of evidence) {
    if (!expected.has(entry.feature) || measured.has(entry.feature)) throw new Error(`Invalid evidence membership: ${entry.feature}`);
    measured.set(entry.feature, entry);
  }
  const missing: string[] = [], blocked: string[] = [], mismatched: string[] = [];
  let passed = 0;
  for (const feature of features) {
    const id = typeof feature === "string" ? feature : feature.id;
    const requirements = typeof feature === "string" ? ["exact"] : feature.requirements;
    const entry = measured.get(id);
    if (!entry) missing.push(id);
    else if (entry.state === "blocked") blocked.push(id);
    else if (entry.state === "mismatched") mismatched.push(id);
    else if (entry.state !== "passed" || !entry.receipts ||
      ![entry.receipts.sourceHash, entry.receipts.profileHash, entry.receipts.inputHash,
        entry.receipts.referenceHash, entry.receipts.candidateHash].every(value => typeof value === "string" &&
          value.length === 64 && [...value].every(char => "0123456789abcdef".includes(char))) ||
      requirements.length === 0 || !requirements.every(requirement => {
        if (requirement === "exact") return entry.exact === true;
        if (requirement === "semantic") return entry.semantic === true;
        if (requirement === "roundTrip") return entry.roundTrip === true;
        if (requirement === "interoperability") return entry.interoperability === true;
        return Object.hasOwn(entry.checks ?? {}, requirement) && entry.checks?.[requirement] === true;
      }) || (entry.structured &&
      (entry.semantic !== true || entry.roundTrip !== true || entry.interoperability !== true))) missing.push(id);
    else passed++;
  }
  return { pass: features.length > 0 && passed === features.length, denominator: features.length, passed, missing, blocked, mismatched };
}
