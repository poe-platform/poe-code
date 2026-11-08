export declare const STYLE_BOLD:number,STYLE_DIM:number,STYLE_UNDERLINE:number,STYLE_INVERSE:number;
export type PackedStyle=number;
export declare function packStyle(style:{bold?:boolean;dim?:boolean;underline?:boolean;inverse?:boolean;fg?:number;bg?:number}):PackedStyle;
export declare function foreground(style:PackedStyle):number;
export declare function background(style:PackedStyle):number;
export declare function styleToSgrDelta(previous:PackedStyle,next:PackedStyle,colors?:boolean):string;
