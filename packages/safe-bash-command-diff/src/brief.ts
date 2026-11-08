import { Budget } from "safe-bash-diff-engine/shared";

/** Compare without a line index, including arbitrarily long lines and binary files. */
export async function compareBrief(budget: Budget, left: string, right: string, text: boolean, countEqualLines = false): Promise<boolean> {
  const sources = [budget.diffSource(left), budget.diffSource(right)];
  const blocks: (Uint8Array | undefined)[] = [undefined, undefined];
  const offsets = [0, 0];
  const ended = [false, false];
  const lines = [0, 0];
  const last = [-1, -1];
  let binary = false, same = true;
  let failure: { error: unknown } | undefined;
  try {
    while (!ended[0] || !ended[1]) {
      for (let side = 0; side < 2; side++) {
        if (!ended[side] && (!blocks[side] || offsets[side] === blocks[side]!.length)) {
          // Release the previous owned block before requesting another.
          blocks[side] = undefined;
          const next = await sources[side]!.next();
          ended[side] = next.done === true;
          offsets[side] = 0;
          if (!next.done) {
            blocks[side] = next.value;
            for (const byte of next.value) {
              binary ||= byte === 0;
              if (byte === 10) lines[side]!++;
            }
            last[side] = next.value.at(-1)!;
            budget.step(next.value.length);
            const checkpoint = budget.checkpoint();
            if (checkpoint) await checkpoint;
          }
        }
      }
      if (ended[0] && ended[1]) break;
      if (ended[0] || ended[1]) {
        same = false;
        const side = ended[0] ? 1 : 0;
        offsets[side] = blocks[side]!.length;
        continue;
      }
      const length = Math.min(blocks[0]!.length - offsets[0]!, blocks[1]!.length - offsets[1]!);
      for (let index = 0; index < length; index++) {
        if (blocks[0]![offsets[0]! + index] !== blocks[1]![offsets[1]! + index]) same = false;
      }
      offsets[0]! += length;
      offsets[1]! += length;
    }
    // Binary and equal ordinary comparisons bypass line splitting in the buffered command.
    if ((text || !binary) && (!same || countEqualLines)) {
      budget.countLines(lines[0]! + lines[1]! + Number(last[0] !== -1 && last[0] !== 10) + Number(last[1] !== -1 && last[1] !== 10));
    }
  } catch (error) { failure = { error }; }
  // Retire both handles even if one close rejects, without racing active reads.
  const results = await Promise.allSettled(sources.map(source => source.return(undefined)));
  if (failure) throw failure.error;
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return same;
}
