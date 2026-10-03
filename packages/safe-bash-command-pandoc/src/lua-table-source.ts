/*! Table algorithms adapted from Fengari/Lua.
MIT License

Copyright © 2017-2019 Benoit Giannangeli
Copyright © 2017-2025 Daurnimator
Copyright © 1994–2017 Lua.org, PUC-Rio.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/** Fixed library code runs on the retained VM, including all metamethod calls.
 * Native helpers only convert scalars or stream values already in backed tables. */
export const luaTableSource = `
local pack, int, str, finish, unpackValues, random = ...
local type, select, error = type, select, error
local function check(t)
  if type(t) ~= 'table' then error('Expected Lua table') end
end
local function size(t)
  check(t)
  return int(#t)
end
local function optional(value, fallback)
  if value == nil then return fallback end
  return int(value)
end
local library = {pack=pack}
function library.insert(t, ...)
  local e = int(size(t) + 1.0)
  local n = select('#', ...)
  local pos, value
  if n == 1 then pos=e; value=...
  elseif n == 2 then
    pos, value = ...
    pos = int(pos)
    if pos < 1 or pos > e then error('Position out of bounds') end
    local i=e
    while i > pos do t[i]=t[i-1]; i=i-1 end
  else error('Wrong number of arguments to insert') end
  t[pos]=value
end
function library.remove(t, pos)
  local n=size(t)
  pos=optional(pos,n)
  if pos ~= n and (pos < 1 or pos > n+1.0) then error('Position out of bounds') end
  local value=t[pos]
  while pos < n do t[pos]=t[pos+1]; pos=pos+1 end
  t[pos]=nil
  return value
end
function library.move(t, first, last, target, dest)
  first=int(first); last=int(last); target=int(target)
  if dest == nil then dest=t end
  check(t); check(dest)
  if last >= first then
    if first <= 0 and last >= 2147483647.0+first then error('Too many elements to move') end
    local n=int(last-first+1.0)
    if target > 2147483647.0-n+1 then error('Destination wrap around') end
    if target > last or target <= first or not (t == dest) then
      for i=0,n-1 do dest[target+i]=t[first+i] end
    else
      for i=n-1,0,-1 do dest[target+i]=t[first+i] end
    end
  end
  return dest
end
function library.concat(t, sep, first, last)
  local n=size(t)
  if sep == nil then sep='' else sep=str(sep) end
  first=optional(first,1); last=optional(last,n)
  local values, count={},0
  while first <= last do
    count=count+1.0
    values[count]=str(t[first])
    if first == last then break end
    first=first+1
  end
  return finish(values,count,sep)
end
function library.unpack(t, first, last)
  first=optional(first,1)
  local n=int(#t)
  last=optional(last,n)
  local values,count={},0
  while first <= last do
    count=count+1.0
    values[count]=t[first]
    if first == last then break end
    first=first+1
  end
  return unpackValues(values,count)
end
local function less(a,b,compare)
  if compare == nil then return a < b end
  return compare(a,b)
end
local function partition(t,lo,up,pivot,compare)
  local i,j=lo,up-1
  while true do
    i=i+1
    local a=t[i]
    while less(a,pivot,compare) do
      if i == up-1 then error('Invalid order function for sorting') end
      i=i+1; a=t[i]
    end
    j=j-1
    local b=t[j]
    while less(pivot,b,compare) do
      if j < i then error('Invalid order function for sorting') end
      j=j-1; b=t[j]
    end
    if j < i then t[up-1]=a; t[i]=pivot; return i end
    t[i]=b; t[j]=a
  end
end
local function sort(t,lo,up,rnd,compare)
  while lo < up do
    local a,b=t[lo],t[up]
    if less(b,a,compare) then t[lo]=b; t[up]=a end
    if up-lo == 1 then return end
    local p
    if up-lo < 100 or rnd == 0 then p=lo+(up-lo)//2
    else local quarter=(up-lo)//4; p=int(rnd%(quarter*2)+(lo+quarter)) end
    a=t[p]; b=t[lo]
    if less(a,b,compare) then t[p]=b; t[lo]=a
    else
      b=t[up]
      if less(b,a,compare) then t[p]=b; t[up]=a end
    end
    if up-lo == 2 then return end
    local pivot=t[p]
    a=t[up-1]
    t[p]=a; t[up-1]=pivot
    p=partition(t,lo,up,pivot,compare)
    local n
    if p-lo < up-p then
      sort(t,lo,p-1,rnd,compare)
      n=p-lo; lo=p+1
    else
      sort(t,p+1,up,rnd,compare)
      n=up-p; up=p-1
    end
    if (up-lo)/128 > n then rnd=random() end
  end
end
function library.sort(t,compare)
  local n=size(t)
  if n > 1 then
    if n >= 2147483647 then error('Array too big') end
    if compare ~= nil and type(compare) ~= 'function' then error('Expected comparison function') end
    sort(t,1,n,0,compare)
  end
end
return library
`;
