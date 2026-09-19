export interface NativeProcess {
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  completion: Promise<{ status: number | null; signal: string | null }>;
  writeInput(bytes: Uint8Array): Promise<void>;
  kill(): void;
}

/** Tooling-only process adapter, with separate owned capture streams and a combined byte cap. */
export async function collectProcess(child: NativeProcess, stdin: Uint8Array, timeoutMs: number, maxBytes: number) {
  let consumed = 0;
  let outputLimitExceeded = false;
  let timedOut = false;
  let streamFailure = false;
  const errors: string[] = [];
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const consume = async (source: AsyncIterable<Uint8Array>) => {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of source) {
        if (chunk.byteLength > maxBytes - consumed) {
          outputLimitExceeded = true;
          child.kill();
          break;
        }
        consumed += chunk.byteLength;
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) { streamFailure = true; errors.push(String(error)); child.kill(); }
    return Buffer.concat(chunks).toString('base64');
  };
  try {
    const [stdoutBase64, stderrBase64, outcome] = await Promise.all([
      consume(child.stdout), consume(child.stderr), child.completion,
      child.writeInput(stdin).catch(error => {
        // Native early exit commonly closes stdin; retain the event as harness
        // evidence rather than inventing a product stderr diagnostic.
        errors.push(`stdin: ${String(error)}`);
      })
    ]);
    return { stdoutBase64, stderrBase64, ...outcome, timedOut, outputLimitExceeded, captureComplete: !streamFailure && !timedOut && !outputLimitExceeded, harnessEvents: errors };
  } finally { clearTimeout(timer); }
}
