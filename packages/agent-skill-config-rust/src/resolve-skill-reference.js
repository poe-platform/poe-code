import {native}from'./native.js';import {files}from'./host.js';
export function resolveSkillReference(ref,cwd,homeDir){return files(callback=>native.skillResolve(ref,cwd,homeDir,callback));}
