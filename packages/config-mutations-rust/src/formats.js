import {native} from './native.js';
import {jsonFormat} from './json.js';
import {tomlFormat} from './toml.js';
import {yamlFormat} from './yaml.js';
export {jsonFormat,tomlFormat,yamlFormat};
const registry={json:jsonFormat,toml:tomlFormat,yaml:yamlFormat};
export function getConfigFormat(pathOrName){const selected=native.configGetFormat(pathOrName);if(selected.error)throw Error(selected.error);return registry[selected.format];}
export function detectFormat(path){return native.configDetectFormat(path)??undefined;}
