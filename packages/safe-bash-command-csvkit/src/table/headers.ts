export function defaultHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    let name = "";
    do { name = String.fromCharCode(97 + index % 26) + name; index = Math.floor(index / 26) - 1; } while (index >= 0);
    return name;
  });
}
import type { Runtime } from "../runtime.js";
import { CsvkitBlocked } from "../errors.js";
import { warningText } from "../diagnostics/index.js";

// Python's warning registry spans every table constructed by one executable.
const warningRegistries = new WeakMap<Runtime, Set<string>>();

/** Agate deduplicate(column_names=True), including collisions with suffixed names. */
export async function normalizeHeaders(headers: readonly string[], runtime: Runtime): Promise<string[]> {
  const generated = defaultHeaders(headers.length);
  const final: string[] = [];
  const seen = new Set<string>();
  const emitted = warningRegistries.get(runtime) ?? new Set<string>();
  warningRegistries.set(runtime, emitted);
  const warn = async (category: string, message: string, line: number, source: string): Promise<void> => {
    const profile = runtime.context.columnWarnings;
    if (profile?.suppressWarnings) return;
    if (!profile?.utilsPath) throw new CsvkitBlocked("Agate duplicate/unnamed column warning provenance");
    // Python's default warnings filter emits a repeated message once per source location.
    const identity = category + message;
    if (emitted.has(identity)) return;
    runtime.retain(32 + identity.length * 2);
    emitted.add(identity);
    await runtime.write(warningText({ path: profile.utilsPath, category, message, line, source }), "stderr");
  };
  for (const [index, header] of headers.entries()) {
    runtime.step();
    const name = header || generated[index]!;
    if (!header) await warn("UnnamedColumnWarning", `Column ${index} has no name. Using "${name}".`, 272, "warn_unnamed_column(i, new_value)");
    let result = name; let duplicates = 0;
    while (seen.has(result)) { runtime.step(); result = name + "_" + (++duplicates + 1); }
    if (duplicates) await warn("DuplicateColumnWarning", `Column name "${name}" already exists in Table. Column will be renamed to "${result}".`, 288, "warn_duplicate_column(new_value, final_value)");
    runtime.retain(32 + result.length * 2);
    seen.add(result); final.push(result);
  }
  return final;
}
