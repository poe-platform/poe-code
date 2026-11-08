export function drainWork<T>(work: Generator<void, T, void>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
