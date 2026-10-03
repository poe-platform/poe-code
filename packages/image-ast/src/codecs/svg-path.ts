import {SvgNumber} from "./svg-number.js";

export type SvgPathToken = string | number;
export type SvgPathPoint = readonly [number, number];

/** Shared path evaluation. Undefined requests one token; points use the existing
 * fixed curve subdivisions. The return value preserves any close-path command. */
export function* svgPathSteps(): Generator<SvgPathPoint | undefined, boolean, SvgPathToken | undefined> {
    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    let closed = false;
    let cmd = "M";
    let token = yield undefined;
    while (token !== undefined) {
      if (typeof token === "string") {
        cmd = token;
        if (cmd === "Z" || cmd === "z") {
          closed = true;
          curX = startX;
          curY = startY;
          token = yield undefined;
          continue;
        }
        token = yield undefined;
      }
      let pending = true;
      const first = token;
      const readNum = function* (): Generator<SvgPathPoint | undefined, number, SvgPathToken | undefined> {
        const value = pending ? first : yield undefined; pending = false;
        return value === undefined ? 0 : typeof value === "number" ? value : parseFloat(value);
      };
      if (cmd === "M" || cmd === "m") {
        const nx = (yield* readNum());
        const ny = (yield* readNum());
        curX = cmd === "m" ? curX + nx : nx;
        curY = cmd === "m" ? curY + ny : ny;
        startX = curX;
        startY = curY;
        yield [curX, curY];
        cmd = cmd === "m" ? "l" : "L";
      } else if (cmd === "L" || cmd === "l") {
        const nx = (yield* readNum());
        const ny = (yield* readNum());
        curX = cmd === "l" ? curX + nx : nx;
        curY = cmd === "l" ? curY + ny : ny;
        yield [curX, curY];
      } else if (cmd === "H" || cmd === "h") {
        const nx = (yield* readNum());
        curX = cmd === "h" ? curX + nx : nx;
        yield [curX, curY];
      } else if (cmd === "V" || cmd === "v") {
        const ny = (yield* readNum());
        curY = cmd === "v" ? curY + ny : ny;
        yield [curX, curY];
      } else if (cmd === "C" || cmd === "c") {
        const x1 = cmd === "c" ? curX + (yield* readNum()) : (yield* readNum());
        const y1 = cmd === "c" ? curY + (yield* readNum()) : (yield* readNum());
        const x2 = cmd === "c" ? curX + (yield* readNum()) : (yield* readNum());
        const y2 = cmd === "c" ? curY + (yield* readNum()) : (yield* readNum());
        const x3 = cmd === "c" ? curX + (yield* readNum()) : (yield* readNum());
        const y3 = cmd === "c" ? curY + (yield* readNum()) : (yield* readNum());
        for (let s = 1; s <= 12; s++) {
          const t = s / 12;
          const mt = 1 - t;
          const bx = mt * mt * mt * curX + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
          const by = mt * mt * mt * curY + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
          yield [bx, by];
        }
        curX = x3;
        curY = y3;
      } else if (cmd === "Q" || cmd === "q") {
        const x1 = cmd === "q" ? curX + (yield* readNum()) : (yield* readNum());
        const y1 = cmd === "q" ? curY + (yield* readNum()) : (yield* readNum());
        const x2 = cmd === "q" ? curX + (yield* readNum()) : (yield* readNum());
        const y2 = cmd === "q" ? curY + (yield* readNum()) : (yield* readNum());
        for (let s = 1; s <= 10; s++) {
          const t = s / 10;
          const mt = 1 - t;
          const bx = mt * mt * curX + 2 * mt * t * x1 + t * t * x2;
          const by = mt * mt * curY + 2 * mt * t * y1 + t * t * y2;
          yield [bx, by];
        }
        curX = x2;
        curY = y2;
      }
      token = yield undefined;
    }
    return closed;
}

/** Legacy SVG path lexical grammar. Numeric yields request a character offset;
 * object yields emit a token. Scratch is bounded even for a single huge literal. */
export function* svgPathTokenSteps(): Generator<number | {readonly token: SvgPathToken}, void, string | undefined> {
 const digit=(char:string|undefined)=>char!==undefined&&char>="0"&&char<="9";
 let position=0;
 while(true){
  const char=yield position;if(char===undefined)return;
  if(char>="A"&&char<="Z"||char>="a"&&char<="z"){yield {token:char};position++;continue;}
  let end=position,current:string|undefined=char;
  const number=new SvgNumber();
  if(current==="+"||current==="-"){number.accept(current);current=yield ++end;}
  let digits=0;
  while(digit(current)){number.accept(current!);digits++;current=yield ++end;}
  if(current==="."){number.accept(current);current=yield ++end;while(digit(current)){number.accept(current!);digits++;current=yield ++end;}}
  if(!digits){position++;continue;}
  if(current==="e"){
   let exponent=end+1,next=yield exponent,sign="";
   if(next==="+"||next==="-"){sign=next;next=yield ++exponent;}
   if(digit(next)){
    number.accept("e");if(sign)number.accept(sign);
    while(digit(next)){number.accept(next!);next=yield ++exponent;}
    end=exponent;
   }
  }
  position=end;yield {token:number.value("float")};
 }
}

export function* svgPathTokens(raw: string): Generator<SvgPathToken> {
 const steps=svgPathTokenSteps();let next=steps.next();
 try{while(!next.done){
  if(typeof next.value==="number")next=steps.next(raw[next.value]);
  else{yield next.value.token;next=steps.next();}
 }}finally{steps.return();}
}
