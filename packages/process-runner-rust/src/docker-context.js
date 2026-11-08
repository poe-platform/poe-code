import {execSync}from'node:child_process';import {native}from'./native.js';
export function buildContextArgs(engine,context){return native.dockerContextArgs(engine,context);}
export function detectContext(){try{return native.dockerDetectContext(execSync('colima list --json',{encoding:'utf-8',stdio:['pipe','pipe','ignore']}));}catch{return null;}}
