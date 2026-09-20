import {execSync}from'node:child_process';import {native}from'./native.js';
export function isEngineAvailable(engine){try{execSync(`${engine} --version`,{stdio:'ignore'});return true;}catch{return false;}}
export function detectEngine(){return native.dockerDetectEngine(isEngineAvailable);}
