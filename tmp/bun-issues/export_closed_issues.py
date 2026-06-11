import calendar
import datetime as dt
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path('tmp/bun-issues')
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'https://api.github.com/search/issues'
HEADERS = {'Accept':'application/vnd.github+json','User-Agent':'poe-code-agent-script-research'}

def request(params):
    url = BASE + '?' + urllib.parse.urlencode(params)
    while True:
        try:
            req=urllib.request.Request(url,headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as response:
                data=json.load(response)
                remaining=int(response.headers.get('x-ratelimit-remaining','1'))
                reset=int(response.headers.get('x-ratelimit-reset',str(int(time.time()))))
            if remaining == 0:
                time.sleep(max(1, reset-int(time.time())+1))
            return data
        except urllib.error.HTTPError as error:
            if error.code in (403,429):
                reset=int(error.headers.get('x-ratelimit-reset',str(int(time.time())+65)))
                wait=max(2,reset-int(time.time())+2)
                print(f'rate limited; sleeping {wait}s',flush=True)
                time.sleep(wait)
                continue
            raise

def months(start_year, start_month, end_year, end_month):
    year, month=start_year,start_month
    while (year,month) <= (end_year,end_month):
        last=calendar.monthrange(year,month)[1]
        yield dt.date(year,month,1),dt.date(year,month,last)
        month+=1
        if month==13: year,month=year+1,1

def count_range(start,end):
    q=f'repo:oven-sh/bun is:issue is:closed created:{start.isoformat()}..{end.isoformat()}'
    return request({'q':q,'per_page':1})['total_count']

def split_range(start,end):
    count=count_range(start,end)
    print(f'count {start}..{end}: {count}',flush=True)
    if count <= 1000:
        return [(start,end,count)]
    if start == end:
        raise RuntimeError(f'single day exceeds search cap: {start} count={count}')
    midpoint=start+(end-start)//2
    return split_range(start,midpoint)+split_range(midpoint+dt.timedelta(days=1),end)

ranges=[]
for start,end in months(2021,1,2026,6):
    ranges.extend(split_range(start,end))
(OUT/'ranges.json').write_text(json.dumps([(str(a),str(b),c) for a,b,c in ranges],indent=2))

issues={}
for index,(start,end,count) in enumerate(ranges,1):
    q=f'repo:oven-sh/bun is:issue is:closed created:{start.isoformat()}..{end.isoformat()}'
    pages=math.ceil(count/100)
    for page in range(1,pages+1):
        data=request({'q':q,'per_page':100,'page':page,'sort':'created','order':'asc'})
        for issue in data['items']:
            issues[issue['number']]=issue
        print(f'range {index}/{len(ranges)} page {page}/{pages}: unique={len(issues)}',flush=True)

ordered=sorted(issues.values(),key=lambda x:x['number'])
(OUT/'closed-issues.json').write_text(json.dumps(ordered))
with (OUT/'closed-issues.jsonl').open('w') as file:
    for issue in ordered:
        file.write(json.dumps(issue,separators=(',',':'))+'\n')
print(f'TOTAL={len(ordered)} EXPECTED={sum(c for _,_,c in ranges)}',flush=True)
if len(ordered) != sum(c for _,_,c in ranges):
    raise SystemExit('count mismatch')
