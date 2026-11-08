export declare const SERVE_TOOL_NAMES:readonly ['encrypt','word-of-the-day'];
export type ServeToolName=typeof SERVE_TOOL_NAMES[number];
export declare function isServeToolName(value:string):value is ServeToolName;
export declare function getNextSpawnCount(currentValue:string|undefined):number;
