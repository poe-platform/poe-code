// Date distinctions and authored-offset restoration follow smol-toml's
// BSD-3-Clause Date contract. See THIRD_PARTY_NOTICES.md.
export class TomlDate extends Date {
 #hasDate;#hasTime;#offset;
 constructor(epoch,hasDate,hasTime,offset){super(epoch);this.#hasDate=hasDate;this.#hasTime=hasTime;this.#offset=offset;}
 isDateTime(){return this.#hasDate&&this.#hasTime;}
 isLocal(){return !this.#hasDate||!this.#hasTime||!this.#offset;}
 isDate(){return this.#hasDate&&!this.#hasTime;}
 isTime(){return this.#hasTime&&!this.#hasDate;}
 isValid(){return this.#hasDate||this.#hasTime;}
 toISOString(){
  const iso=super.toISOString();
  if(this.isDate())return iso.slice(0,10);
  if(this.isTime())return iso.slice(11,23);
  if(this.#offset===null)return iso.slice(0,-1);
  if(this.#offset==='Z')return iso;
  let offset=Number(this.#offset.slice(1,3))*60+Number(this.#offset.slice(4,6));offset=this.#offset[0]==='-'?offset:-offset;
  return new Date(this.getTime()-offset*60000).toISOString().slice(0,-1)+this.#offset;
 }
}
