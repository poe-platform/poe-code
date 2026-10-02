/// <reference types="node" />
export type Action = "up" | "down" | "left" | "right" | "space" | "enter" | "cancel";
export declare function mapKey(name: string | undefined, char: string | undefined): Action | undefined;
