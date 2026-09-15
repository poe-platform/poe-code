/** Internal native fault shared by binary-transform kernels. Publication must
 * use the interpreter-owned binascii.Error type, not a guest substitute. */
export class BinasciiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "binascii.Error";
  }
}
