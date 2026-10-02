import { sha256 } from 'safe-bash-checksum-engine/sha256';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { attachmentDigestHex } from './attachment-id.js';
import { base64Stream } from './base64-stream.js';
import { sourceBytes } from './request-source.js';
import { jsonValue } from './json-value.js';
import type { LlmInputSource } from './types.js';

/** Hash while encoding; putting filename after file_data avoids a second read
 * or buffering an arbitrary-size PDF just to determine its reference ID. */
export async function* pdfJson(source: LlmInputSource, id: string | undefined, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const hash = id === undefined ? sha256.create() : undefined;
  const encoder = new TextEncoder();
  async function* content(): AsyncIterable<Uint8Array> {
    let windows = 0;
    for await (const input of sourceBytes(source.bytes, signal)) {
      if (!input.length && ++windows % 64 === 0) await yieldTurn(signal);
      for (let offset = 0; offset < input.length; offset += 16384) {
        signal.throwIfAborted();
        if (++windows % 64 === 0) await yieldTurn(signal);
        const bytes = input.subarray(offset, offset + 16384);
        hash?.update(bytes);
        yield bytes;
      }
    }
  }
  try {
    signal.throwIfAborted();
    yield encoder.encode('{"type":"file","file":{"file_data":"data:application/pdf;base64,');
    for await (const part of base64Stream(content(), signal)) yield encoder.encode(part);
    signal.throwIfAborted();
    yield encoder.encode('","filename":');
    yield* jsonValue(`${id ?? attachmentDigestHex(hash!.digest())}.pdf`, signal);
    yield encoder.encode('}}');
  } finally { hash?.destroy(); }
}
