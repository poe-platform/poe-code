import {Buffer} from 'node:buffer';
export class Snapshot {
 constructor(){this.buffer=Buffer.allocUnsafe(1024);this.offset=0;}
 reserve(length){const end=this.offset+length;if(end>this.buffer.length){const buffer=Buffer.allocUnsafe(Math.max(end,this.buffer.length*2));this.buffer.copy(buffer,0,0,this.offset);this.buffer=buffer;}const start=this.offset;this.offset=end;return start;}
 tag(value){const offset=this.reserve(1);this.buffer[offset]=value;}
 count(value){const offset=this.reserve(4);this.buffer.writeUInt32LE(value,offset);return offset;}
 text(value){this.count(value.length);const offset=this.reserve(value.length*2);this.buffer.write(value,offset,value.length*2,'utf16le');}
 number(value){const offset=this.reserve(8);this.buffer.writeDoubleLE(value,offset);}
 finish(){return this.buffer.subarray(0,this.offset);}
}
