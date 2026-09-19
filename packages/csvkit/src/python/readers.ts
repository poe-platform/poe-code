/** Guest source for the preloaded reader object boundary. CSV parsing remains
 * an explicit, bounded synchronous capability; no host object enters the guest.
 * Agate 1.14.2 csv_py3.py and CPython DictReader ordering are the source contract.
 */
export const rawReaderLibrary = `class Error(Exception):pass
class Dialect:
 def __init__(self,values):self._values=values
 @property
 def delimiter(self):return self._values[0]
 @property
 def quotechar(self):return self._values[1]
 @property
 def escapechar(self):return self._values[2]
 @property
 def quoting(self):return self._values[3]
 @property
 def doublequote(self):return self._values[4]
 @property
 def skipinitialspace(self):return self._values[5]
 @property
 def lineterminator(self):return '\\r\\n'
 @property
 def strict(self):return False
${["delimiter", "quotechar", "escapechar", "quoting", "doublequote", "skipinitialspace", "lineterminator", "strict"].map(name => ` @${name}.setter
 def ${name}(self,value):raise AttributeError("attribute '${name}' of '_csv.Dialect' objects is not writable")
`).join("")}
class _CSVReader:
 def __init__(self,read,dialect):
  self._read=read
  self._line_num=0
  self._dialect=dialect
 def __iter__(self):return self
 @property
 def line_num(self):return self._line_num
 @property
 def dialect(self):return self._dialect
 def __next__(self):
  item=self._read()
  if item[0]=='end':raise StopIteration
  self._line_num=item[2]
  if item[0]=='value-error':raise ValueError(item[1])
  if item[0]=='field-error':raise Error(item[1])
  if item[0]=='error':raise Error(item[1])
  return item[1]
`;

export const readerLibrary = `class Reader:
 def __init__(self,read,dialect):
  self.reader=_CSVReader(read,dialect)
  self.line_numbers=False
  self.header=True
 def __iter__(self):return self
 @property
 def line_num(self):return self.reader.line_num
 @property
 def dialect(self):return self.reader.dialect
 def __next__(self):
  try:row=next(self.reader)
  except _CSVError as e:
   if 'field larger than field limit' in str(e):raise FieldSizeLimitError(_field_limit,self.line_num)
   raise
  if self.line_numbers:
   if self.header and self.line_num==1:row.insert(0,'line_numbers')
   else:row.insert(0,str(self.line_num-1 if self.header else self.line_num))
  return row
class DictReader:
 def __init__(self,read,dialect):
  self.reader=_CSVReader(read,dialect)
  self.line_num=0
  self.dialect='excel'
  self._fieldnames=None
  self.restkey=None
  self.restval=None
 def __iter__(self):return self
 @property
 def fieldnames(self):
  if self._fieldnames is None:
   try:self._fieldnames=next(self.reader)
   except StopIteration:pass
  self.line_num=self.reader.line_num
  return self._fieldnames
 @fieldnames.setter
 def fieldnames(self,value):self._fieldnames=value
 def __next__(self):
  if self.line_num==0:self.fieldnames
  row=next(self.reader)
  self.line_num=self.reader.line_num
  while not row:row=next(self.reader)
  names=self.fieldnames
  result=dict(zip(names,row))
  if len(row)>len(names):result[self.restkey]=row[len(names):]
  elif len(row)<len(names):
   for name in names[len(row):]:result[name]=self.restval
  return result
`;

export const exceptionsLibrary = `class DataTypeError(TypeError):pass
class UnsupportedAggregationError(TypeError):pass
class CastError(Exception):pass
class FieldSizeLimitError(Exception):
 def __init__(self,limit,line_number):
  super().__init__('CSV contains a field longer than the maximum length of %i characters on line %i. Try raising the maximum with the field_size_limit parameter, or try setting quoting=csv.QUOTE_NONE.' % (limit,line_number))
`;
