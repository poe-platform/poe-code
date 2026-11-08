import type { PdfPixelStorage } from "../ast.js";
import { StoredType1CharString } from "../vendor/pdfjs-fonts.mjs";
import { StoredFontValues } from "./stored-values.js";
import { StoredFontBytes } from "./stored-font-bytes.js";

export class StoredType1Converter {
  private readonly operands: StoredFontValues;
  private readonly frames: StoredFontValues;
  private readonly native: StoredType1CharString;
  constructor(
    private readonly programs: StoredFontBytes,
    private readonly output: StoredFontBytes,
    storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {
    this.operands = new StoredFontValues(storage, signal);
    this.frames = new StoredFontValues(storage, signal);
    this.native = new StoredType1CharString(this.operands, output);
  }
  async convert(
    start: number,
    length: number,
    subrs: { get(index: number): Promise<{ start: number; length: number } | undefined> }
  ) {
    this.signal?.throwIfAborted();
    this.operands.clear();
    this.frames.clear();
    const state = this.native;
    state.width = 0;
    state.lsb = 0;
    state.flexing = false;
    state.seac = undefined;
    const outputStart = this.output.length,
      programs = this.programs;
    const index = {
      async get(id: number) {
        const entry = await subrs.get(id);
        return entry ? programs.range(entry.start, entry.start + entry.length) : undefined;
      }
    };
    let code = programs.range(start, start + length),
      at = 0,
      depth = 0,
      error = false,
      requests = 0;
    while (true) {
      if (++requests % 4096 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.signal?.throwIfAborted();
      if (at >= code.length) {
        if (!depth) break;
        const frame = --depth * 3;
        start = (await this.frames.get(frame))!;
        length = (await this.frames.get(frame + 1))!;
        at = (await this.frames.get(frame + 2))!;
        code = programs.range(start, start + length);
        continue;
      }
      const steps = state.convertStep(code, index, true, at);
      let result;
      try {
        let step = steps.next();
        while (!step.done) {
          this.signal?.throwIfAborted();
          step = steps.next(await step.value);
        }
        result = step.value;
      } finally {
        steps.return({ error: true, done: true });
      }
      if (result.error) {
        error = true;
        break;
      }
      if (result.call) {
        const frame = depth++ * 3;
        await this.frames.set(frame, code.start);
        await this.frames.set(frame + 1, code.length);
        await this.frames.set(frame + 2, result.next!);
        code = programs.range(result.call.start, result.call.start + result.call.length);
        at = 0;
      } else at = result.done ? code.length : result.next!;
    }
    if (error) {
      this.output.truncate(outputStart);
      await this.output.push(14);
    }
    return {
      code: this.output.range(outputStart),
      width: state.width,
      lsb: state.lsb,
      seac: state.seac as number[] | undefined
    };
  }
}
