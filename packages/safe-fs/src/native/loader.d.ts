export interface NativeSeekBinding {
  seekEnd(descriptor: number): Promise<{ offset: bigint; errno: number }>;
}

export function loadBinding(): Promise<NativeSeekBinding>;
