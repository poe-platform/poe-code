import type {ComposerState} from "./composer-types.js";
type ComposerLayout = {lines: string[]; starts: number[]; cursor: {x: number; y: number}};
export declare function layoutComposer(state: ComposerState, width: number): ComposerLayout;
