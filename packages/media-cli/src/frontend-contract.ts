import type { FrontendContract } from '@poe-code/remote-execution/wire';
import { grammarRevision, nativeReference } from './options.generated.js';
import { imageMagickGrammarRevision, imageMagickReference } from './imagemagick.generated.js';

/** The shipped JS identity is shared by client and server admission. It cannot
 * be rewritten by a caller to authorize another native build. */
export const mediaFrontendContract: Readonly<FrontendContract> = Object.freeze({
  grammarRevision: [grammarRevision, imageMagickGrammarRevision].join('+'),
  sourceRevision: [nativeReference.id, imageMagickReference.id].join('+'),
});
