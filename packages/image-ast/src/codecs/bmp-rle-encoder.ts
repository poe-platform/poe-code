/** BI_RLE8 encoded runs, capped at 255 pixels and terminated at each row. */
export class BmpRleEncoder {
 private count = 0;
 private index = 0;
 push(index: number): number[] {
  if (this.count && (index !== this.index || this.count === 255)) {
   const run = [this.count, this.index];
   this.count = 1; this.index = index;
   return run;
  }
  this.count++; this.index = index;
  return [];
 }
 endRow(): number[] {
  const run = [this.count, this.index, 0, 0];
  this.count = 0;
  return run;
 }
}
