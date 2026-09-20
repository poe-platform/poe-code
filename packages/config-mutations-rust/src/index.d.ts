export type ConfigValue=string|number|boolean|null|ConfigObject|ConfigValue[]|Date;
export interface ConfigObject{[key:string]:ConfigValue;}
export interface ConfigFormat{
 parse(content:string):ConfigObject;
 serialize(obj:ConfigObject):string;
 serializeUpdate?(content:string,current:ConfigObject,next:ConfigObject):string;
 merge(base:ConfigObject,patch:ConfigObject):ConfigObject;
 prune(obj:ConfigObject,shape:ConfigObject):{changed:boolean;result:ConfigObject};
}
