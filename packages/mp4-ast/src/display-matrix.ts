/** Apply the movie transform after the track transform in MP4 fixed-point units. */
export function composeDisplayMatrices(track: readonly number[], movie: readonly number[]): number[] {
  const result: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let value = 0n;
      for (let k = 0; k < 3; k++) {
        // Each product is shifted separately, including negative fractional values.
        value += BigInt(track[row * 3 + k]!) * BigInt(movie[k * 3 + column]!) >> (k === 2 ? 30n : 16n);
      }
      result.push(Number(BigInt.asIntN(32, value)));
    }
  }
  return result;
}
