export { normalizePageRange, defaultOutputName } from './arguments.js';
export {
  parsePdftotextArguments, PdftotextAdmissionError,
  type PdftotextArguments, type AdmissionLimits, type AdmissionAccounting,
} from './admission.js';
export { encodePdftotextOutput, type OutputEncoding, type EncodingLimits, type EncodedOutput } from './encoding.js';
export { serializeBboxWord } from './bbox.js';

export { createPdftotextCommand, pdftotextCommand, pdftotextCommands, pdftotext, type PdftotextCommandOptions, type PdftotextRunOptions, type PdftotextResult } from './command.js';
