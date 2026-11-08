import {native} from './native.js';
const policies=native.agentMcpShapePolicies();
function createShape(style){
 const states=policies[style];
 return entry=>{
  let cached,command,currentValue,result={},request=states[0];
   while(true){
    let kind='unit',flag=false,value;
    switch(request.kind){
     case 'enabled':kind='flag';flag=entry.enabled!==false;break;
     case 'transport':kind='flag';flag=entry.config.transport==='stdio';break;
     case 'cache':cached=entry.config;break;
     case 'command':value=(request.cached?cached:entry.config).command;command=value;kind='value';break;
     case 'argsCheck':kind='flag';flag=request.cached?Boolean(cached.args&&cached.args.length>0):Boolean(entry.config.args&&entry.config.args.length>0);break;
     case 'args':value=(request.cached?cached:entry.config).args;kind='value';break;
     case 'spread':value=request.args?[command,...cached.args]:[command];kind='value';break;
     case 'envCheck':kind='flag';flag=request.cached?Boolean(cached.env&&Object.keys(cached.env).length>0):Boolean(entry.config.env&&Object.keys(entry.config.env).length>0);break;
     case 'env':value=(request.cached?cached:entry.config).env;kind='value';break;
     case 'url':value=entry.config.url;kind='value';break;
     case 'headersCheck':kind='flag';flag=Boolean(entry.config.headers&&Object.keys(entry.config.headers).length>0);break;
     case 'headers':value=entry.config.headers;kind='value';break;
     case 'emit':{
      const value=request.valueKind==='reference'?currentValue:request.value;
      if(request.assign)result[request.key]=value;
      else result={...result,[request.key]:value};
      break;
     }
     case 'done':return request.present?result:undefined;
     default:throw new Error('Invalid native shape request');
    }
    if(kind==='value')currentValue=value;
    request=states[kind==='flag'?(flag?request.yes:request.no):request.next];
   }
 };
}
export const standardShape=createShape('standard'),opencodeShape=createShape('opencode'),gooseShape=createShape('goose');
const transformers={standard:standardShape,opencode:opencodeShape,goose:gooseShape};
export function getShapeTransformer(shape){return transformers[shape];}
