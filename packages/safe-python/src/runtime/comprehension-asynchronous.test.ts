import {expect,it} from "vitest";
import {parseExpression} from "../expression.js";
import {ExecutionBudget} from "./execution-budget.js";
import {comprehensionIsAsynchronous} from "./comprehension-asynchronous.js";

it.each([
  ["(x for x in xs)",false],
  ["(x for x in await source())",false],
  ["(x async for x in xs)",true],
  ["(await f(x) for x in xs)",true],
  ["(x for x in xs if await f(x))",true],
  ["(y for x in xs for y in await f(x))",true],
  ["(y for x in xs async for y in ys)",true],
  ["([y async for y in ys] for x in xs)",true],
  ["((await f(y) for y in ys) for x in xs)",false],
  ["((y async for y in ys) for x in xs)",false],
  ["((y for y in await f(x)) for x in xs)",true],
  ["((lambda: (y async for y in ys)) for x in xs)",false],
  ["((lambda a=await f(x): a) for x in xs)",true]
] as const)("classifies only awaits executed by the comprehension: %s",(source,expected)=>{
  const node=parseExpression(source);
  if(node.kind!=="comprehension")throw Error("expected comprehension");
  expect(comprehensionIsAsynchronous(node,new ExecutionBudget({maxSteps:1000,maxAllocatedBytes:10000}))).toBe(expected);
});
