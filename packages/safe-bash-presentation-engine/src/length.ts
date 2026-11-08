import { callableConstructor } from "./callable-constructor.js";
import { TypeError as ModelTypeError, ValueError } from "./errors.js";
class LengthValue {
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
export type Length = LengthValue;
export const Length = callableConstructor(LengthValue);

class EmuValue extends Length {}
class InchesValue extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 914400);
  }
}
class CmValue extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 360000);
  }
}
class MmValue extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 36000);
  }
}
class PtValue extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 12700);
  }
}
class CentipointsValue extends Length {
  constructor(value: number) {
    if (typeof value !== "number") throw new ModelTypeError("Length must be numeric.");
    super(value * 127);
  }
}

export type Emu = EmuValue;
export const Emu = callableConstructor(EmuValue);

export type Inches = InchesValue;
export const Inches = callableConstructor(InchesValue);

export type Cm = CmValue;
export const Cm = callableConstructor(CmValue);

export type Mm = MmValue;
export const Mm = callableConstructor(MmValue);

export type Pt = PtValue;
export const Pt = callableConstructor(PtValue);

export type Centipoints = CentipointsValue;
export const Centipoints = callableConstructor(CentipointsValue);
