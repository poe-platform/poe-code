import { sha256 } from 'safe-bash-checksum-engine/sha256';
import { yieldTurn } from 'safe-bash-contracts/yield';
import { validateAttachmentUrl } from './url-attachment.js';

export function attachmentDigestHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Reference Attachment.id() for URL origins; null matches an empty buffered
 * content attachment with neither a path nor URL. No network request is made. */
export async function getLlmAttachmentUrlId(url: string | null, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (url !== null) validateAttachmentUrl(url);
  const hash = sha256.create(), encoder = new TextEncoder();
  try {
    hash.update(encoder.encode('{"url": '));
    if (url === null) hash.update(encoder.encode('null'));
    else {
      hash.update(Uint8Array.of(34));
      for (let offset = 0; offset < url.length; offset += 2048) {
        signal.throwIfAborted();
        if (offset && offset % 16384 === 0) await yieldTurn(signal);
        const json = JSON.stringify(url.slice(offset, offset + 2048)).slice(1, -1);
        let ascii = '';
        for (let index = 0; index < json.length; index++) {
          const code = json.charCodeAt(index);
          ascii += code >= 127 ? '\\u' + code.toString(16).padStart(4, '0') : json[index];
        }
        hash.update(encoder.encode(ascii));
      }
      hash.update(Uint8Array.of(34));
    }
    hash.update(Uint8Array.of(125));
    return attachmentDigestHex(hash.digest());
  } finally { hash.destroy(); }
}

export async function attachmentBytesId(bytes: Uint8Array, signal: AbortSignal): Promise<string> {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      signal.throwIfAborted();
      if (offset && offset % 1048576 === 0) await yieldTurn(signal);
      hash.update(bytes.subarray(offset, offset + 16384));
    }
    signal.throwIfAborted();
    return attachmentDigestHex(hash.digest());
  } finally { hash.destroy(); }
}
