import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Default C3 linearization over existing immutable base MROs. Class creation,
 * metaclass overrides, layout checks, and __bases__ mutation are separate layers.
 */
export function linearizeMro<Type extends { readonly name: string }>(
  type: Type,
  bases: readonly Type[],
  getMro: (base: Type) => readonly Type[],
  meter?: ExecutionMeter
): readonly Type[] {
  meter?.checkpoint();
  const sequences: (readonly Type[])[] = [];
  const seen = new Set<Type>();
  for (const base of bases) {
    meter?.checkpoint();
    if (base === type) throw new PythonRuntimeError("TypeError", "a __bases__ item causes an inheritance cycle");
    if (seen.has(base)) throw new PythonRuntimeError("TypeError", `duplicate base class ${base.name}`);
    seen.add(base);
    sequences.push(getMro(base));
  }
  sequences.push(bases);
  meter?.checkpoint(0, sequences.length * Uint32Array.BYTES_PER_ELEMENT);
  const cursors = new Uint32Array(sequences.length);
  // Counts make tail membership constant-time instead of rescanning every
  // ancestor list for each candidate. Input sequences are never shifted/copied.
  const tails = new Map<Type, number>();
  for (const sequence of sequences) {
    for (let index = 0; index < sequence.length; index++) {
      meter?.checkpoint();
      const entry = sequence[index]!;
      if (entry === type) throw new PythonRuntimeError("TypeError", "a __bases__ item causes an inheritance cycle");
      if (index !== 0) tails.set(entry, (tails.get(entry) ?? 0) + 1);
    }
  }
  const result: Type[] = [type];
  while (true) {
    let candidate: Type | undefined;
    let pending = false;
    for (let index = 0; index < sequences.length; index++) {
      meter?.checkpoint();
      const sequence = sequences[index]!, cursor = cursors[index]!;
      if (cursor === sequence.length) continue;
      pending = true;
      const head = sequence[cursor]!;
      if (!tails.has(head)) { candidate = head; break; }
    }
    if (candidate === undefined) {
      if (!pending) return Object.freeze(result);
      const conflicts = new Set<Type>();
      for (let index = 0; index < sequences.length; index++) {
        meter?.checkpoint();
        const head = sequences[index]![cursors[index]!];
        if (head !== undefined) conflicts.add(head);
      }
      const names: string[] = [];
      for (const conflict of conflicts) { meter?.checkpoint(); names.push(conflict.name); }
      throw new PythonRuntimeError("TypeError", `Cannot create a consistent method resolution order (MRO) for bases ${names.join(", ")}`);
    }
    result.push(candidate);
    for (let index = 0; index < sequences.length; index++) {
      meter?.checkpoint();
      const sequence = sequences[index]!, cursor = cursors[index]!;
      if (sequence[cursor] !== candidate) continue;
      cursors[index] = cursor + 1;
      if (cursor + 1 < sequence.length) {
        const next = sequence[cursor + 1]!;
        const count = tails.get(next)!;
        if (count === 1) tails.delete(next);
        else tails.set(next, count - 1);
      }
    }
  }
}
