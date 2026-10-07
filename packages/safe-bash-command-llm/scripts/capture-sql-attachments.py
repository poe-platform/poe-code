import os,tempfile,json,sqlite3,pathlib,llm
from click.testing import CliRunner
from llm.cli import cli
from importlib.metadata import version
assert version('llm')=='0.27.1'
class Model(llm.EmbeddingModel):
 model_id='e'
 def embed_batch(self,items):
  for item in items:yield [1.,1.]
class Plugin:
 @llm.hookimpl
 def register_embedding_models(self,register):register(Model())
llm.plugins.pm.register(Plugin(),name='fixture-attach')
cases=[
 dict(name='missing',args=['--attach','source','missing.db','--sql',"SELECT 1,'ok'"]),
 dict(name='main-alias',args=['--attach','main','missing.db','--sql',"SELECT 1,'ok'"]),
 dict(name='duplicate',args=['--attach','source','source.db','--attach','source','missing.db','--sql',"SELECT 1,'ok'"]),
 dict(name='broken',args=['--attach','source','broken.db','--sql',"SELECT 1,'ok'"]),
 dict(name='unused-broken',args=['--attach','source','broken.db','-','--format','csv']),
 dict(name='unused-missing',args=['--attach','source','missing.db','-','--format','csv']),
 dict(name='bracket',args=['--attach','bad]','missing.db','--sql',"SELECT 1,'ok'"]),
 dict(name='missing-parent',args=['--attach','source','absent/source.db','--sql',"SELECT 1,'ok'"]),
 dict(name='directory',args=['--attach','source','directory','--sql',"SELECT 1,'ok'"]),
 dict(name='missing-model',args=['--attach','source','missing.db','--sql',"SELECT 1,'ok'"],no_model=True),
]
root=os.getcwd();result=[]
for case in cases:
 with tempfile.TemporaryDirectory(dir=root+'/out') as directory:
  os.chdir(directory)
  pathlib.Path('directory').mkdir();pathlib.Path('broken.db').write_bytes(b'not sqlite')
  c=sqlite3.connect('source.db');c.execute('CREATE TABLE data(content TEXT)');c.commit();c.close()
  args=['embed-multi','docs','-d','main.db']+([] if case.get('no_model') else ['-m','e'])+case['args']
  outcome=CliRunner(mix_stderr=False).invoke(cli,args,input='id,content\n1,ok\n',env={'LLM_USER_PATH':directory+'/config','LLM_EMBEDDING_MODEL':''})
  files={p.name:p.stat().st_size for p in pathlib.Path('.').iterdir() if p.is_file()}
  tables=[]
  if pathlib.Path('main.db').exists():
   c=sqlite3.connect('main.db');tables=[r[0] for r in c.execute('SELECT name FROM sqlite_master WHERE type="table" ORDER BY name')];c.close()
  error=outcome.exception
  result.append(dict(**case,code=outcome.exit_code,out=outcome.stdout,err=outcome.stderr.replace(directory,'/work'),exception=None if error is None else dict(type=type(error).__name__,message=str(error).replace(directory,'/work')),files=files,tables=tables))
  os.chdir(root)
print(json.dumps(result,indent=2))
