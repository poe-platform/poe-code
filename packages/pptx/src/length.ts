import { TypeError as ModelTypeError, ValueError } from "./errors.js";
export class Length {
  readonly emu: number;
  constructor(emu: number) {
    if (typeof emu !== "number") throw new ModelTypeError("Length must be numeric.");
    if (!Number.isFinite(emu) || Math.abs(emu) > Number.MAX_SAFE_INTEGER)
      throw new ValueError("Length must be finite and within the safe integer range.");
    const rounded = Math.sign(emu) * Math.round(Math.abs(emu));
    if (!Number.isSafeInteger(rounded)) throw new ValueError("Length exceeds safe integer range.");
    this.emu = rounded === 0 ? 0 : rounded;
    Object.freeze(this);
  }
  get inches(): number {
    return this.emu / 914400;
  }
  get cm(): number {
    return this.emu / 360000;
  }
  get mm(): number {
    return this.emu / 36000;
  }
  get pt(): number {
    return this.emu / 12700;
  }
  get centipoints(): number {
    return Math.floor(this.emu / 127);
  }
}
export class Emu extends Length {}
export class Inches extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 914400);
  }
}
export class Cm extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 360000);
  }
}
export class Mm extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 36000);
  }
}
export class Pt extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 12700);
  }
}
export class Centipoints extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 127);
  }
}
