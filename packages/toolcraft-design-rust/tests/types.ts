import {renderTemplate,getTemplatePartialNames,resolveTemplatePartials,TemplateParseError,type RenderTemplateOptions} from '../dist/index.js';
const options:RenderTemplateOptions={escape:'none',partials:{header:'{{name}}'},validate:true,yield:'Child'};
const text:string=renderTemplate('{{> header}} {{yield}}',{name:'K'},options);
const names:string[]=getTemplatePartialNames(text);
const expanded:string=resolveTemplatePartials(text,Object.fromEntries(names.map(name=>[name,'value'])));
const error:Error=new TemplateParseError(expanded,{line:1,column:1});void error;
