import json,llm,sqlite_utils
from click.testing import CliRunner
from llm.cli import cli
from importlib.metadata import version
assert version('llm')=='0.27.1'
class Fixture(llm.EmbeddingModel):
 model_id='e'
 batch_size=2
 def embed_batch(self,items):
  items=list(items);calls.append(items)
  for item in items: yield [1.0,1.0]
class Plugin:
 @llm.hookimpl
 def register_embedding_models(self,register):register(Fixture())
llm.plugins.pm.register(Plugin(),name='fixture-sql')
Database=sqlite_utils.Database
cases=["SELECT 7 AS id,'first' AS content", "SELECT NULL AS id,'old' AS content,NULL AS empty,'new' AS content", "SELECT 1.5 AS id,0 AS empty,'text' AS text", "SELECT x'27225c0a' AS id,'bytes id' AS content", "SELECT 'id' AS id,x'' AS content", "SELECT 'id' AS id,1 AS content", "SELECT 'id' AS id,1.5 AS content", "SELECT 'id' AS id,x'61' AS content", "SELECT 'id' AS id", "SELECT 1 AS id,'first' AS content UNION ALL SELECT 2,'second'", "SELECT 1 AS id,'first' AS content UNION ALL SELECT 2,'second' UNION ALL SELECT 3,'third'"]
results=[]
for sql in cases:
 db=Database(memory=True);calls=[]
 sqlite_utils.Database=lambda *args,**kwargs:db
 result=CliRunner(mix_stderr=False).invoke(cli,['embed-multi','docs','--sql',sql,'-m','e','-d','/db','--store','--prefix','p:','--prepend','before '])
 rows=list(db.query('SELECT id,content FROM embeddings ORDER BY id'))
 results.append(dict(sql=sql,code=result.exit_code,out=result.stdout,err=result.stderr,calls=calls,exception=None if result.exception is None else dict(type=type(result.exception).__name__,message=str(result.exception)),rows=rows))
 sqlite_utils.Database=Database
print(json.dumps(results,ensure_ascii=False,indent=2))
