export function errorFields(reason){
 const result={thrownType:reason===null?'null':typeof reason,fields:{}};
 for(const key of ['name','code','errno','syscall']){
  let owner=reason,descriptor,depth=0;try{while(owner!==null&&(typeof owner==='object'||typeof owner==='function')&&depth++<4){descriptor=Object.getOwnPropertyDescriptor(owner,key);if(descriptor)break;owner=Object.getPrototypeOf(owner);}}catch{result.fields[key]={presence:'uninspectable'};continue;}
  if(!descriptor){result.fields[key]={presence:'absent'};continue;}
  if(!Object.hasOwn(descriptor,'value')){result.fields[key]={presence:'accessor-not-invoked'};continue;}
  const value=descriptor.value;if(typeof value==='string'){result.fields[key]=value.length<=128?{presence:'value',value}:{presence:'over-limit',length:value.length};}else if(typeof value==='number'&&Number.isSafeInteger(value)){result.fields[key]={presence:'value',value};}else{result.fields[key]={presence:'unsupported',valueType:typeof value};}
 }return result;
}
export function classifyGroup(threw,reason){if(!threw)return {state:'present',error:null};const error=errorFields(reason);return {state:error.fields.code.presence==='value'&&error.fields.code.value==='ESRCH'?'absent':'unknown',error};}
