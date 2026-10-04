/** Pango default tabs leave at least one space before the next eight-space stop. */
export function nextPrintTabStop(width: number, tabWidth: number): number {
  return Math.ceil((width + tabWidth / 8) / tabWidth) * tabWidth;
}

/** Mirror tab-run boxes without reversing the already-shaped glyphs inside each run. */
export function mirrorPrintTabRuns(glyphs: {x: number}[], runs: readonly {
  start: number; end: number; first: number; last: number;
}[], width: number, tick: () => void): void {
  for (const run of runs) {
    tick();
    const offset = width - run.end - run.start;
    for (let index = run.first; index < run.last; index++) {
      tick();
      glyphs[index]!.x += offset;
    }
  }
}
