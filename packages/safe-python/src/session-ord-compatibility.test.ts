import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const definition = `
events=[]
class Text(str):
 def __str__(self):
  events.append('str')
  return 'z'
 def __len__(self):
  events.append('len')
  return 99
 def __getitem__(self,index):
  events.append('getitem')
  return 'z'
class Other:
 def __str__(self):
  events.append('str')
  return 'x'
 def __index__(self):
  events.append('index')
  return 65
`;

it.each([
  ["Text('a')", "assert result==97"],
  ["Text('😀')", "assert result==128512"],
  ["Text('\\ud800')", "assert result==55296"],
  ["Text('')", "assert result==('TypeError','ord() expected a character, but string of length 0 found')"],
  ["Text('😀x')", "assert result==('TypeError','ord() expected a character, but string of length 2 found')"],
  ["Other()", "assert result==('TypeError','ord() expected string of length 1, but Other found')"],
  ["object()", "assert result==('TypeError','ord() expected string of length 1, but object found')"],
  ["[]", "assert result==('TypeError','ord() expected string of length 1, but list found')"],
  ["None", "assert result==('TypeError','ord() expected string of length 1, but NoneType found')"],
  ["b'\\xff'", "assert result==255"],
  ["'\\U0010ffff'", "assert result==1114111"]
])("ord inspects native storage and reports guest types for %s", (expression, assertion) => {
  const s = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(s.exec(`${definition}\ntry: result=ord(${expression})\nexcept TypeError as e: result=(type(e).__name__,e.args[0])\n${assertion}\nassert events==[]`).status).toBe("ok");
});
