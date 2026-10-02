import { acceptsMimeType } from './mime.js';

/** Wire representation supported by the reference chat provider. Model admission
 * remains separate: a host must advertise the MIME types that its model accepts. */
export function openAiAttachmentKind(mimeType: string): 'image' | 'wav' | 'mp3' | 'pdf' {
  if (acceptsMimeType(['image/*'], mimeType)) return 'image';
  if (acceptsMimeType(['audio/wav'], mimeType)) return 'wav';
  if (acceptsMimeType(['audio/mpeg'], mimeType)) return 'mp3';
  if (acceptsMimeType(['application/pdf'], mimeType)) return 'pdf';
  throw new TypeError(`Unsupported OpenAI attachment type: ${mimeType}`);
}
