import {native} from './native.js';
import {files} from './host.js';
export function assertNoSymbolicLink(targetPath,opts){files(callback=>native.hookAssertPath(targetPath,opts?.root,callback));}
