import {jsonFormat,modifyAtPath,detectIndent,serializeUpdate} from '../dist/json.js';
import type {ConfigObject,ConfigFormat} from '../dist/index.js';
const format:ConfigFormat=jsonFormat;
const object:ConfigObject=format.parse('{}');
const text:string=format.serialize(object);
modifyAtPath(text,['nested',0],new Date());detectIndent(text);serializeUpdate(text,object,object);
