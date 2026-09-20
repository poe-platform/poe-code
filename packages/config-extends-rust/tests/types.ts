import * as native from '../dist/index.js';
import * as sdk from '@poe-code/config-extends';
const parse:typeof sdk.parseDocument=native.parseDocument;
const merge:typeof sdk.mergeLayers=native.mergeLayers;
void [parse,merge];
