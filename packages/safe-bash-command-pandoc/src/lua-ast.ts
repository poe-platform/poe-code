/** Pandoc's Lua element view, constructors and bottom-up filter traversal. */
export const luaAst = `
local check_depth = __pandoc_depth
local ast_error = __pandoc_ast_error
local list_mt
list_mt = {__index = {
  insert = table.insert,
  remove = table.remove,
  extend = function(self, other) for _, x in ipairs(other) do table.insert(self, x) end end,
  includes = function(self, val, init) for i = init or 1, #self do if self[i] == val then return true, i end end return false end,
  find = function(self, val, init) for i = init or 1, #self do if self[i] == val then return self[i], i end end return nil end,
  find_if = function(self, pred, init) for i = init or 1, #self do if pred(self[i]) then return self[i], i end end return nil end,
  filter = function(self, pred) local out = {} for i = 1, #self do if pred(self[i]) then out[#out + 1] = self[i] end end return setmetatable(out, list_mt) end,
  map = function(self, fn) local out = {} for i = 1, #self do out[#out + 1] = fn(self[i]) end return setmetatable(out, list_mt) end,
  clone = function(self) local out = {} for i = 1, #self do out[i] = self[i] end return setmetatable(out, list_mt) end,
  walk = function(self, filter) return pandoc.walk_block(self, filter) end
}}
local function list(xs) return setmetatable(xs or {}, list_mt) end
local function is_attr(value)
  if type(value) ~= "table" or #value ~= 3 or type(value[1]) ~= "string" or type(value[2]) ~= "table" or type(value[3]) ~= "table" then return false end
  for _, cls in ipairs(value[2]) do if type(cls) ~= "string" then return false end end
  local raw = value[3]
  if #raw > 0 then
    for _, pair in ipairs(raw) do
      if type(pair) ~= "table" or #pair ~= 2 or type(pair[1]) ~= "string" or type(pair[2]) ~= "string" then return false end
    end
  else
    for key, text in pairs(raw) do
      if type(key) ~= "string" or type(text) ~= "string" then return false end
    end
  end
  return true
end
local function attr(value)
  if type(value) == "string" then value = {value, {}, {}} end
  value = value or {"", {}, {}}
  local attrs = {}
  local raw = value[3] or {}
  if #raw > 0 then
    for _, pair in ipairs(raw) do attrs[pair[1]] = pair[2] end
  else
    for key, text in pairs(raw) do if type(key) == "string" then attrs[key] = text end end
  end
  return {value[1] or "", list(value[2]), attrs}
end
local function encode_attr(value)
  value = attr(value)
  local pairs_list = {}
  for key, text in pairs(value[3] or {}) do pairs_list[#pairs_list+1] = {key, tostring(text)} end
  return {value[1], value[2], pairs_list}
end
local empty_attr = function() return attr() end
local schemas = {
  Str = {"text"}, Emph = {"content"}, Underline = {"content"}, Strong = {"content"},
  Strikeout = {"content"}, Superscript = {"content"}, Subscript = {"content"}, SmallCaps = {"content"},
  Quoted = {"quotetype", "content"}, Cite = {"citations", "content"}, Code = {"attr", "text"},
  Math = {"mathtype", "text"}, RawInline = {"format", "text"},
  Link = {"attr", "content", "target", "title"}, Image = {"attr", "caption", "src", "title"},
  Note = {"content"}, Span = {"attr", "content"}, Plain = {"content"}, Para = {"content"},
  LineBlock = {"content"}, CodeBlock = {"attr", "text"}, RawBlock = {"format", "text"},
  BlockQuote = {"content"}, OrderedList = {"listAttributes", "content"}, BulletList = {"content"},
  DefinitionList = {"content"}, Header = {"level", "attr", "content"}, Div = {"attr", "content"},
  Figure = {"attr", "caption", "content"}, Table = {"attr", "caption", "colspecs", "head", "bodies", "foot"},
  MetaString = {"text"}, MetaBool = {"value"}, MetaInlines = {"content"}, MetaBlocks = {"content"},
  MetaList = {"content"}, MetaMap = {"content"}, ColWidth = {"value"}
}
local single = {Str=true, Emph=true, Underline=true, Strong=true, Strikeout=true, Superscript=true, Subscript=true, SmallCaps=true, Note=true, Plain=true, Para=true, LineBlock=true, BlockQuote=true, BulletList=true, DefinitionList=true, MetaString=true, MetaBool=true, MetaInlines=true, MetaBlocks=true, MetaList=true, MetaMap=true, ColWidth=true}
local inline = {Str=true, Space=true, SoftBreak=true, LineBreak=true, Emph=true, Underline=true, Strong=true, Strikeout=true, Superscript=true, Subscript=true, SmallCaps=true, Quoted=true, Cite=true, Code=true, Math=true, RawInline=true, Link=true, Image=true, Note=true, Span=true}
local block = {Plain=true, Para=true, LineBlock=true, CodeBlock=true, RawBlock=true, BlockQuote=true, OrderedList=true, BulletList=true, DefinitionList=true, Header=true, HorizontalRule=true, Div=true, Figure=true, Table=true}
__pandoc_callbacks = {Inline=true, Inlines=true, Block=true, Blocks=true, Meta=true, Pandoc=true}
for tag in pairs(inline) do __pandoc_callbacks[tag] = true end
for tag in pairs(block) do __pandoc_callbacks[tag] = true end
local element_mt = {__index = function(el, key)
  if key == "identifier" then return el.attr and el.attr[1] end
  if key == "classes" then return el.attr and el.attr[2] end
  if key == "attributes" then return el.attr and el.attr[3] end
  if key == "t" then return el.tag end
  if key == "walk" then return function(self, filter) return pandoc.walk_block(self, filter) end end
  if (el.tag == "MetaMap" or el.tag == "MetaList") and type(el.content) == "table" then return el.content[key] end
end, __newindex = function(el, key, value)
  if key == "identifier" then el.attr[1] = value
  elseif key == "classes" then el.attr[2] = list(value)
  elseif key == "attributes" then el.attr[3] = value
  else rawset(el, key, value) end
end}
local function element(tag, values)
  local el = setmetatable({tag=tag}, element_mt)
  for i, name in ipairs(schemas[tag] or {}) do el[name] = name == "attr" and attr(values[i]) or values[i] end
  return el
end
pandoc = {List = list, Attr = function(id, classes, attributes) return attr({id or "", classes or {}, attributes or {}}) end}
for tag, schema in pairs(schemas) do
  pandoc[tag] = function(...)
    local args = {...}
    if tag == "Header" then args = {args[1], args[3] or empty_attr(), args[2] or {}}
    elseif tag == "Code" or tag == "CodeBlock" then assert(type(args[1]) == "string", tag .. " requires text"); args = {args[2] or empty_attr(), args[1]}
    elseif tag == "Link" or tag == "Image" then args = {args[4] or empty_attr(), args[1] or {}, args[2] or "", args[3] or ""}
    elseif tag == "Span" or tag == "Div" then args = {args[2] or empty_attr(), args[1] or {}}
    elseif tag == "Table" then args = {args[6] or empty_attr(), args[1], args[2], args[3], args[4], args[5]}
    elseif tag == "OrderedList" then args = {args[2] or {1, "DefaultStyle", "DefaultDelim"}, args[1] or {}}
    elseif tag == "Str" then assert(type(args[1]) == "string", "pandoc.Str requires text")
    elseif schema[1] == "content" then assert(type(args[1]) == "table", tag .. " requires content") end
    return element(tag, args)
  end
end
for _, tag in ipairs({"Space", "SoftBreak", "LineBreak", "HorizontalRule"}) do pandoc[tag] = function() return element(tag, {}) end end
pandoc.Pandoc = function(blocks, meta) return {blocks=list(blocks), meta=meta or {}} end
local function stringify(value)
  if type(value) == "string" then return value end
  if type(value) ~= "table" then return "" end
  if value.tag == "Str" or value.tag == "Code" or value.tag == "CodeBlock" then return value.text end
  if value.tag == "Space" or value.tag == "SoftBreak" or value.tag == "LineBreak" then return " " end
  if value.content then return stringify(value.content) end
  local parts = {}; for _, item in ipairs(value) do parts[#parts+1] = stringify(item) end
  return table.concat(parts)
end
pandoc.utils = {stringify=stringify}
local function decode(value)
  if type(value) ~= "table" then return value end
  if value.__pandoc_null then return value end
  if value.t == "MetaString" or value.t == "MetaBool" then return value.c end
  if value.t then
    local tag, c = value.t, value.c
    local values = {}
    if single[tag] then values[1] = decode(c)
    elseif tag == "Link" or tag == "Image" then values = {decode(c[1]), decode(c[2]), c[3][1], c[3][2]}
    else for i, child in ipairs(c or {}) do values[i] = decode(child) end end
    return element(tag, values)
  end
  local result = {}; for key, child in pairs(value) do result[key] = decode(child) end
  return list(result)
end
local function encode(value, depth)
  depth = depth or 0; check_depth(depth)
  if type(value) ~= "table" then return value end
  if value.__pandoc_null then return value end
  if value.tag then
    assert(schemas[value.tag] or inline[value.tag] or block[value.tag] or value.tag == "ColWidthDefault", "Unknown Lua element tag")
    if not schemas[value.tag] then return {t=value.tag} end
    local c = {}
    for i, name in ipairs(schemas[value.tag] or {}) do c[i] = name == "attr" and encode_attr(value[name]) or encode(value[name], depth + 1) end
    if value.tag == "Link" or value.tag == "Image" then c = {c[1], c[2], {c[3], c[4]}} end
    if single[value.tag] then c = c[1] end
    return {t=value.tag, c=c}
  end
  if is_attr(value) then return encode_attr(value) end
  local result = {}; for key, child in pairs(value) do result[key] = encode(child, depth + 1) end
  return result
end
local function copy(value, depth)
  depth = depth or 0; check_depth(depth)
  if type(value) ~= "table" then return value end
  local result = setmetatable({}, getmetatable(value))
  for key, child in pairs(value) do result[key] = copy(child, depth + 1) end
  return result
end
local function apply_callback(callback, value)
  if callback == nil then return value end
  assert(type(callback) == "function", "Lua callback must be a function")
  local result = callback(copy(value))
  if result == nil then return value end
  if type(result) ~= "table" then ast_error() end
  return result
end
local function walk_with_filter(root_value, filter, root_kind)
  assert(type(filter) == "table", "Lua walk filter must be a table")
  local value = copy(root_value)
  for _, phase in ipairs({"Inline", "Inlines", "Block", "Blocks"}) do
    local walk
    walk = function(cur, kind, depth)
      depth = depth or 0; check_depth(depth)
      if type(cur) ~= "table" then return cur end
      if cur.tag then
        local tag = cur.tag
        for _, field in ipairs(schemas[tag] or {}) do
          if field ~= "attr" then
            local listkind
            if field == "caption" and tag == "Image" or field == "content" and (inline[tag] and tag ~= "Note" or tag == "Plain" or tag == "Para" or tag == "Header" or tag == "MetaInlines") then listkind = "Inlines"
            elseif field == "content" and (tag == "Note" or tag == "Div" or tag == "BlockQuote" or tag == "MetaBlocks" or tag == "Figure") then listkind = "Blocks" end
            cur[field] = walk(cur[field], listkind, depth + 1)
          end
        end
        if phase == "Inline" and inline[tag] or phase == "Block" and block[tag] then
          return apply_callback(filter[tag] or filter[phase], cur)
        end
        return cur
      end
      local result = list({})
      for key, child in pairs(cur) do
        local replacement = walk(child, nil, depth + 1)
        if type(key) == "number" and type(child) == "table" and child.tag and (inline[child.tag] or block[child.tag]) and not replacement.tag then
          for _, item in ipairs(replacement) do result[#result+1] = item end
        elseif type(key) == "number" then result[#result+1] = replacement
        else result[key] = replacement end
      end
      if not kind and #cur > 0 and type(cur[1]) == "table" then
        if inline[cur[1].tag] then kind = "Inlines" elseif block[cur[1].tag] then kind = "Blocks" end
      end
      return apply_callback(kind == phase and filter[kind] or nil, result)
    end
    value = walk(value, root_kind)
  end
  return value
end
pandoc.walk_inline = function(el, filter) return walk_with_filter(el, filter) end
pandoc.walk_block = function(el, filter) return walk_with_filter(el, filter) end
function __pandoc_run(ast, filters)
  local doc = {blocks=decode(ast.blocks), meta=decode(ast.meta)}
  for _, filter in ipairs(filters) do
    for _, phase in ipairs({"Inline", "Inlines", "Block", "Blocks"}) do
    local walk
    walk = function(value, kind, depth)
      depth = depth or 0; check_depth(depth)
      if type(value) ~= "table" then return value end
      if value.tag then
        local tag = value.tag
        for _, field in ipairs(schemas[tag] or {}) do
          if field ~= "attr" then
          local listkind
          if field == "caption" and tag == "Image" or field == "content" and (inline[tag] and tag ~= "Note" or tag == "Plain" or tag == "Para" or tag == "Header" or tag == "MetaInlines") then listkind = "Inlines"
          elseif field == "content" and (tag == "Note" or tag == "Div" or tag == "BlockQuote" or tag == "MetaBlocks" or tag == "Figure") then listkind = "Blocks" end
          value[field] = walk(value[field], listkind, depth + 1)
          end
        end
        if phase == "Inline" and inline[tag] or phase == "Block" and block[tag] then
          return apply_callback(filter[tag] or filter[phase], value)
        end
        return value
      end
      local result = list({})
      for key, child in pairs(value) do
        local replacement = walk(child, nil, depth + 1)
        if type(key) == "number" and type(child) == "table" and child.tag and (inline[child.tag] or block[child.tag]) and not replacement.tag then
          for _, item in ipairs(replacement) do result[#result+1] = item end
        elseif type(key) == "number" then result[#result+1] = replacement
        else result[key] = replacement end
      end
      if not kind and #value > 0 and type(value[1]) == "table" then
        if inline[value[1].tag] then kind = "Inlines" elseif block[value[1].tag] then kind = "Blocks" end
      end
      return apply_callback(kind == phase and filter[kind] or nil, result)
    end
    doc.meta = walk(doc.meta)
    doc.blocks = walk(doc.blocks, "Blocks")
    end
    doc.meta = apply_callback(filter.Meta, doc.meta)
    doc = apply_callback(filter.Pandoc, doc)
  end
  local function encode_meta(value, depth)
    depth = depth or 0; check_depth(depth)
    if type(value) == "string" then return {t="MetaString", c=value} end
    if type(value) == "boolean" then return {t="MetaBool", c=value} end
    if value.tag == "MetaList" or value.tag == "MetaMap" then
      local c = {}
      for key, child in pairs(value.content or {}) do c[key] = encode_meta(child, depth + 1) end
      return {t=value.tag, c=c}
    end
    if value.tag then return encode(value) end
    local c = {}
    for key, child in pairs(value) do c[key] = encode_meta(child, depth + 1) end
    return {t=#value > 0 and "MetaList" or "MetaMap", c=c}
  end
  local meta = {}; for key, value in pairs(doc.meta) do meta[key] = encode_meta(value) end
  return {blocks=encode(doc.blocks), meta=meta}
end
`;
