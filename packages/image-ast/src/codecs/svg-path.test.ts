import {expect,test} from "vitest";
import * as path from "./svg-path.js";

function points(tokens:Iterable<number|string>){
 const input=tokens[Symbol.iterator](),steps=path.svgPathSteps(),result:path.SvgPathPoint[]=[];
 let next=steps.next();
 while(!next.done){if(next.value===undefined)next=steps.next(input.next().value);else{result.push(next.value);next=steps.next();}}
 return {points:result,closed:next.value};
}

test("consumes path tokens on demand and preserves relative commands and closure",()=>{
 expect(points(["M",2,3,"l",4,5,"h",2,"v",-4,"z"])).toEqual({points:[[2,3,1],[6,8],[8,8],[8,4],[2,3]],closed:true});
 const input=path.svgPathSteps();expect(input.next()).toEqual({done:false,value:undefined});
 expect(input.next("M")).toEqual({done:false,value:undefined});expect(input.next(1)).toEqual({done:false,value:undefined});
 expect(input.next(2)).toEqual({done:false,value:[1,2,1]});input.return(false);
});

test("preserves curve subdivision coordinates, implicit lines and incomplete arguments",()=>{
 const cubic=points(["M",0,0,"C",1,2,3,4,5,6]);expect(cubic.points).toHaveLength(13);expect(cubic.points.at(-1)).toEqual([5,6]);
 expect(cubic.points[1]).toEqual([0.2702546296296296,0.49999999999999994]);
 const quadratic=points(["m",1,2,"q",2,4,6,8]);expect(quadratic.points).toHaveLength(11);expect(quadratic.points.at(-1)).toEqual([7,10]);
 expect(points([1,2,3,4,"H"])).toEqual({points:[[1,2,1],[3,4],[0,4]],closed:false});
 expect(points(["M",1,"L",2,3]).points[0]).toEqual([1,NaN,1]);
});

test("tokenizes long decimal and exponent runs without token-sized scratch",()=>{
 const raw='M'+'0'.repeat(100000)+'1 '+'.'+'0'.repeat(100000)+'1L2e-2 -3.5E4z';
 expect([...path.svgPathTokens(raw)]).toEqual(['M',1,0,'L',0.02,-3.5,'E',4,'z']);
 expect([...path.svgPathTokens('1e+ 2..3 -.4 +.5 6e-2 7e+3')]).toEqual([1,'e',2,0.3,-0.4,0.5,0.06,7000]);
});

test("suspends path lexing for caller range reads without owning the source",()=>{
 const steps=path.svgPathTokenSteps(),text='M12 34L56 78',tokens:Array<number|string>=[];let reads=0,next=steps.next();
 while(!next.done){if(typeof next.value==='number'){reads++;next=steps.next(text[next.value]);}else{tokens.push(next.value.token);if(tokens.length===3)break;next=steps.next();}}
 expect(tokens).toEqual(['M',12,34]);expect(reads).toBeLessThan(15);steps.return();
});

test.each([
 ['M1,7 Q1,1 4,4 T7,1', 'M1,7 Q1,1 4,4 Q7,7 7,1'],
 ['M1,7 q0,-6 3,-3 t3,-3', 'M1,7 Q1,1 4,4 Q7,7 7,1'],
 ['M1,7 Q1,1 4,4 T7,1 8,4', 'M1,7 Q1,1 4,4 Q7,7 7,1 Q7,-5 8,4'],
 ['M1,7 q0,-6 3,-3 t3,-3 1,3', 'M1,7 Q1,1 4,4 Q7,7 7,1 Q7,-5 8,4'],
 ['M1,7 C1,1 3,1 4,4 S7,7 7,1', 'M1,7 C1,1 3,1 4,4 C5,7 7,7 7,1'],
 ['M1,7 c0,-6 2,-6 3,-3 s3,3 3,-3', 'M1,7 C1,1 3,1 4,4 C5,7 7,7 7,1'],
 ['M1,7 C1,1 3,1 4,4 S7,7 7,1 8,2 8,4', 'M1,7 C1,1 3,1 4,4 C5,7 7,7 7,1 C7,-5 8,2 8,4'],
 ['M1,7 c0,-6 2,-6 3,-3 s3,3 3,-3 1,1 1,3', 'M1,7 C1,1 3,1 4,4 C5,7 7,7 7,1 C7,-5 8,2 8,4'],
])('reflects the previous control point in %s', (short, long) => {
 expect(points(path.svgPathTokens(short))).toEqual(points(path.svgPathTokens(long)));
});

for (const [curve, short, long] of [
 ['Q1,1 4,4', 'T7,1', 'Q4,4 7,1'],
 ['C1,1 3,1 4,4', 'S7,7 7,1', 'C4,4 7,7 7,1'],
]) {
 test.each(['M4,4', 'L4,4', 'H4', 'V4', 'Z M4,4', 'Z', 'M4,4 4,4'])(`resets ${short} control after %s`, reset => {
  const prefix = `M4,4 ${curve} ${reset}`;
  expect(points(path.svgPathTokens(`${prefix} ${short}`))).toEqual(points(path.svgPathTokens(`${prefix} ${long}`)));
 });
}

test.each([
 ['M4,4 T7,1', 'M4,4 Q4,4 7,1'],
 ['M4,4 S7,7 7,1', 'M4,4 C4,4 7,7 7,1'],
 ['M1,7 C1,1 3,1 4,4 T7,1', 'M1,7 C1,1 3,1 4,4 Q4,4 7,1'],
 ['M1,7 Q1,1 4,4 S7,7 7,1', 'M1,7 Q1,1 4,4 C4,4 7,7 7,1'],
])('uses the current point without a matching previous curve in %s', (short, long) => {
 expect(points(path.svgPathTokens(short))).toEqual(points(path.svgPathTokens(long)));
});
