/** Five-bit histogram bins retain full-precision channel sums and pixel counts. */
export function quantizeGif(histogram: Float64Array, palette: Uint8Array): Uint8Array {
  const bins: number[][] = [];
  for (let id = 0; id < 32768; id++) {
    const at = id * 4,
      count = histogram[at + 3]!;
    if (count)
      bins.push([
        histogram[at]! / count,
        histogram[at + 1]! / count,
        histogram[at + 2]! / count,
        count,
        id
      ]);
  }
  const box = (colors: number[][]) => {
    const sum = [0, 0, 0],
      squares = [0, 0, 0];
    let count = 0;
    for (const color of colors) {
      count += color[3]!;
      for (let c = 0; c < 3; c++) {
        sum[c]! += color[c]! * color[3]!;
        squares[c]! += color[c]! ** 2 * color[3]!;
      }
    }
    const variance = squares.map((value, c) => Math.max(0, value - sum[c]! ** 2 / count));
    const axis = variance.indexOf(Math.max(...variance));
    return { colors, count, sum, axis, error: colors.length > 1 ? variance[axis]! : 0 };
  };
  // Split the highest weighted color variance at its population median.
  // Frequent source colors therefore receive more palette entries.
  const boxes = [box(bins)];
  while (boxes.length < 254) {
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i]!.error > boxes[best]!.error) best = i;
    const current = boxes[best]!;
    if (current.error <= 0) break;
    current.colors.sort((a, b) => a[current.axis]! - b[current.axis]!);
    let count = 0,
      split = 0;
    do {
      count += current.colors[split++]![3]!;
    } while (count < current.count / 2 && split < current.colors.length - 1);
    boxes[best] = box(current.colors.slice(0, split));
    boxes.push(box(current.colors.slice(split)));
  }
  palette.fill(0, 0, 254 * 3);
  for (let i = 0; i < boxes.length; i++) {
    for (let c = 0; c < 3; c++)
      palette[i * 3 + c] = Math.round(boxes[i]!.sum[c]! / boxes[i]!.count);
  }
  // Cache the nearest palette entry once per occupied bin, not once per pixel.
  const indices = new Uint8Array(32768);
  for (const color of bins) {
    let distance = Infinity,
      nearest = 0;
    for (let i = 0; i <= boxes.length; i++) {
      const index = i === boxes.length ? 254 : i;
      let error = 0;
      for (let c = 0; c < 3; c++) error += (color[c]! - palette[index * 3 + c]!) ** 2;
      if (error < distance) {
        distance = error;
        nearest = index;
      }
    }
    indices[color[4]!] = nearest;
  }
  return indices;
}
