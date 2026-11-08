/** Strict structural equality for admitted JSON inventory records. */
export function equalInventory(left:unknown,right:unknown):boolean {
 if(Object.is(left,right))return true;
 if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
 if(Object.getPrototypeOf(left)!==Object.getPrototypeOf(right))return false;
 if(Array.isArray(left)&&Array.isArray(right)&&left.length!==right.length)return false;
 const keys=Reflect.ownKeys(left).filter(key=>Object.prototype.propertyIsEnumerable.call(left,key));
 const otherKeys=Reflect.ownKeys(right).filter(key=>Object.prototype.propertyIsEnumerable.call(right,key));
 return keys.length===otherKeys.length&&keys.every(key=>Object.hasOwn(right,key)&&equalInventory(Reflect.get(left,key),Reflect.get(right,key)));
}
