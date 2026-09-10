export interface RawCodecModule {
  readonly memory: { readonly buffer: ArrayBuffer };
  _initialize?(): void;
  bridge_create(decompress: number, level: number, memoryLimit: number, windowLog: number): number;
  bridge_step(input: number, inputLength: number, output: number, outputLength: number, finish: number): number;
  bridge_destroy(): void;
  bridge_input(): number;
  bridge_output(): number;
  bridge_consumed(): number;
  bridge_produced(): number;
  bridge_used(): number;
  bridge_peak(): number;
}

export type RawCodecFactory = (wasi: Readonly<Record<string, (...arguments_: number[]) => number>>) => RawCodecModule;
