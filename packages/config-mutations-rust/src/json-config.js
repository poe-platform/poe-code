import {native} from './native.js';
import {jsonFormat as codec} from './json.js';
// Public mutation/testing APIs use the SDK's JSONC assignment-and-clone contract.
// The standalone native JSON codec continues to retain all authored own fields.
export const jsonFormat={...codec,parse:native.configJsonParseConfig};
