export type TemplateEscape='html'|'none';
export interface RenderTemplateOptions{escape?:TemplateEscape;partials?:Record<string,string>;validate?:boolean;yield?:string;}
export declare class TemplateParseError extends Error{readonly description:string;readonly line:number;readonly column:number;constructor(description:string,position:{line:number;column:number});}
export declare function getTemplatePartialNames(template:string):string[];
export declare function resolveTemplatePartials(template:string,partials:Record<string,string>):string;
export declare function renderTemplate(template:string,view:Record<string,unknown>,options?:RenderTemplateOptions):string;
