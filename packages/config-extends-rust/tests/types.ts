import * as native from '../dist/index.js';
import * as sdk from '@poe-code/config-extends';
const parse:typeof sdk.parseDocument=native.parseDocument;
const merge:typeof sdk.mergeLayers=native.mergeLayers;
const discovery:typeof sdk.findBase=native.findBase;
const resolution:typeof sdk.resolve=native.resolve;
const prompt:typeof sdk.resolvePromptDocument=native.resolvePromptDocument;
void [parse,merge,discovery,resolution,prompt];
