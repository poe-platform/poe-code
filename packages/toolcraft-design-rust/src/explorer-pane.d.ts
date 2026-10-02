import type {ScreenSurface as ScreenBuffer} from './screen.js';
import type {CellStyle} from './dashboard-types.js';
import type {Rect} from './explorer-layout.js';
export declare function drawPaneFrame(screen:ScreenBuffer,rect:Rect,title:string,style?:CellStyle,options?:{focused?:boolean;indicator?:string}):void;
export {paneBodyRect} from './explorer-layout.js';
