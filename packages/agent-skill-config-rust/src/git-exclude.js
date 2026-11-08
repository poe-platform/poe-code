import {native}from'./native.js';import {files}from'./host.js';
export {setGitDirRunnerForTest}from'./host.js';
export function appendExcludeBlock(cwd,runId,entries,opts){return files(callback=>native.skillAppendExclude(cwd,runId,entries,opts?.markerPrefix,callback))??undefined;}
export function removeExcludeBlock(cwd,runId,opts){files(callback=>native.skillRemoveExclude(cwd,runId,opts?.markerPrefix,callback));}
