import { posix } from "node:path";
import type { BenchmarkCase, Probe } from "./model.js";
import { textBytes } from "./model.js";

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a string");
  return value;
}

function rejectDuplicateKeys(source: string): void {
  let offset = 0;
  const whitespace = () => { while (/\s/u.test(source[offset] ?? "!")) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      if (source[offset++] === "\\") offset++;
      else if (source[offset - 1] === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const value = (depth: number): void => {
    if (depth > 128) throw new RangeError("Fixture JSON nesting is too deep");
    whitespace();
    const opening = source[offset];
    if (opening === '"') { string(); return; }
    if (opening !== "{" && opening !== "[") {
      while (offset < source.length && !/[\s,}\]]/u.test(source[offset]!)) offset++;
      return;
    }
    offset++;
    whitespace();
    const closing = opening === "{" ? "}" : "]";
    const keys = new Set<string>();
    while (source[offset] !== closing) {
      if (opening === "{") {
        const key = string();
        if (keys.has(key)) throw new TypeError(`Duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        offset++;
      }
      value(depth + 1);
      whitespace();
      if (source[offset] === ",") { offset++; whitespace(); }
    }
    offset++;
  };
  value(0);
}

function fileMap(value: unknown): Record<string, string> {
  const files = object(value);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  const paths = Object.keys(files);
  for (const path of paths) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.endsWith("/")
      || posix.normalize(path) !== path || path.split("/").some((part) => part === "." || part === "..")) {
      throw new TypeError(`Unsafe fixture file path: ${path}`);
    }
    if (paths.some((other) => other !== path && other.startsWith(`${path}/`))) {
      throw new TypeError(`File path is also a parent: ${path}`);
    }
    result[path] = textBytes(text(files[path]));
  }
  return result;
}

export function parseFixtures(source: string): BenchmarkCase[] {
  const document = object(JSON.parse(source));
  rejectDuplicateKeys(source);
  if (document.schemaVersion !== 1 || !Array.isArray(document.fixtures) || !document.fixtures.length) {
    throw new TypeError("Expected nonempty version-1 oracle fixtures");
  }
  const names = new Set<string>();
  return document.fixtures.map((entry) => {
    const fixture = object(entry);
    const name = text(fixture.name);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || names.has(name)) throw new TypeError(`Invalid or duplicate fixture name: ${name}`);
    names.add(name);
    const tier = text(fixture.tier);
    if (tier !== "core" && tier !== "advanced-pending") throw new TypeError(`Unknown fixture tier: ${tier}`);
    if (!Array.isArray(fixture.tags) || !fixture.tags.length) throw new TypeError("Missing feature tags");
    const tags = fixture.tags.map(text);
    if (new Set(tags).size !== tags.length) throw new TypeError("Duplicate feature tags");
    const script = text(fixture.script);
    if (script.includes("\0")) throw new TypeError("NUL in script");
    const env = object(fixture.env ?? {});
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || text(value).includes("\0")) throw new TypeError("Invalid fixture environment");
    }
    const expected = object(fixture.expected);
    if (!Number.isInteger(expected.exitCode) || Number(expected.exitCode) < 0 || Number(expected.exitCode) > 255) {
      throw new TypeError("Invalid expected exit status");
    }
    return { name, tier, tags, source: "bash-oracle", script,
      initialFiles: fileMap(fixture.initialFiles ?? {}), stdin: textBytes(text(fixture.stdin ?? "")),
      env: env as Record<string, string>,
      expected: { stdout: textBytes(text(expected.stdout)), stderr: textBytes(text(expected.stderr)),
        exitCode: Number(expected.exitCode), files: fileMap(expected.files) } };
  });
}

export function deterministicCases(seed = 0x5afe2026): BenchmarkCase[] {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const cases: BenchmarkCase[] = [];
  for (let index = 0; index < 16; index++) {
    const length = 64 + random() % 4096;
    const data = Array.from({ length }, () => String.fromCharCode(32 + random() % 95)).join("");
    const bytes = textBytes(data);
    const stages = 2 + random() % 6;
    cases.push({ name: `seeded-pipeline-${index}`, tier: "deterministic", source: "deterministic",
      tags: ["shell.pipeline", "shell.stdin", "stress.deterministic-bytes"],
      script: `${Array.from({ length: stages }, () => "cat").join(" | ")} > output.dat; cat output.dat`,
      initialFiles: {}, stdin: bytes, env: {}, expected: { stdout: bytes, stderr: "", exitCode: 0, files: { "output.dat": bytes } } });
  }
  const binary = Buffer.from([0, 1, 127, 128, 255]).toString("base64");
  cases.push({ name: "binary-file-byte-fidelity", tier: "deterministic", source: "deterministic",
    tags: ["shell.redirection.output", "filesystem.binary", "command.printf"],
    script: "printf '\\000\\001\\177\\200\\377' > binary.dat", initialFiles: {}, stdin: "", env: {},
    expected: { stdout: "", stderr: "", exitCode: 0, files: { "binary.dat": binary } } });
  const large = textBytes("0123456789abcdef\n".repeat(32768));
  cases.push({ name: "large-pipeline-file-roundtrip", tier: "deterministic", source: "deterministic",
    tags: ["shell.pipeline", "shell.stdin", "filesystem.large-file"],
    script: "cat | cat | cat > large.dat; cat large.dat", initialFiles: {}, stdin: large, env: {},
    expected: { stdout: large, stderr: "", exitCode: 0, files: { "large.dat": large } } });
  return cases;
}

export const probes: readonly Probe[] = [
  { kind: "probe", name: "concurrent-pipelines", tier: "stress", tags: ["shell.pipeline", "stress.concurrent-exec"] },
  { kind: "probe", name: "cooperative-cancellation", tier: "stress", tags: ["shell.pipeline", "stress.cancellation"] },
  { kind: "probe", name: "streaming-backpressure", tier: "stress", tags: ["shell.pipeline", "plugins.streaming-command-api", "stress.backpressure"] },
];
