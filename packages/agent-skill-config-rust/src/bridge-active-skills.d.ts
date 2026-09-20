export interface BridgeEntry{ref:string;sourcePath:string;targetPath:string;createdParents:string[];}
export type BridgeWarningKind='local-collision'|'global-collision'|'self-reference'|'intra-batch-collision';
export interface BridgeWarning{kind:BridgeWarningKind;ref:string;sourcePath:string;conflictingPath:string;message:string;}
export interface BridgeManifest{spawnAgentId:string;cwd:string;runId:string;excludeBlockId?:string;entries:BridgeEntry[];warnings:BridgeWarning[];}
export function bridgeActiveSkills(spawnAgentId:string,cwd:string,refs:string[],homeDir:string,runId:string):BridgeManifest;
export function cleanupBridgedSkills(manifest:BridgeManifest):void;
