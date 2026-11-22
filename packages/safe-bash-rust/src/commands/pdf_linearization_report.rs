use super::{PageSource,Value};
use super::super::super::{Location,Objects};
use std::{collections::{BTreeMap,BTreeSet},fmt::Write};

#[derive(Clone,Copy)]
struct Bits<'a>{bytes:&'a[u8],position:usize}
impl<'a> Bits<'a>{
    fn new(bytes:&'a[u8],offset:usize)->Option<Self>{Some(Self{bytes,position:offset.checked_mul(8)?})}
    fn read(&mut self,width:usize)->Option<usize>{
        if width>32 || self.position.checked_add(width)?>self.bytes.len().checked_mul(8)? {return None;}
        let mut value=0;
        for _ in 0..width {value=value*2+usize::from((self.bytes[self.position/8]>>(7-self.position%8))&1);self.position+=1;}
        Some(value)
    }
    fn column(&mut self,count:usize,width:usize)->Option<Self>{
        let cursor=*self;let end=self.position.checked_add(count.checked_mul(width)?)?;
        if end>self.bytes.len().checked_mul(8)?{return None;}
        self.position=end.div_ceil(8)*8;Some(cursor)
    }
}

pub(super) fn report<'a>(source:&mut PageSource<'a>,input:&str,dict:&Value<'a>)->Option<String>{
    let number=|source:&mut PageSource<'a>,key:&[u8]|dict.get(key).and_then(|v|source.objects.resolve(v)).and_then(|v|v.number()).unwrap_or(0.);
    let hints=dict.get(b"H").and_then(|v|source.objects.resolve(v));
    let hint=|source:&mut PageSource<'a>,i|if let Some(Value::Array(items))=&hints {items.get(i).and_then(|v|source.objects.resolve(v)).and_then(|v|v.number()).unwrap_or(0.)}else{0.};
    let ho=hint(source,0);let hl=hint(source,1);
    let values=[number(source,b"L"),number(source,b"O"),number(source,b"E"),source.pages.len() as f64,number(source,b"T"),number(source,b"P"),ho,hl];
    let mut out=format!("{input}: linearization data:\n\n");
    for (key,value) in ["file_size","first_page_object","first_page_end","npages","xref_zero_offset","first_page","H_offset","H_length"].into_iter().zip(values){writeln!(out,"{key}: {value}").ok()?;}
    let header=source.objects.bytes[..source.objects.bytes.len().min(1024)].windows(5).position(|w|w==b"%PDF-")?;
    let hint_id=source.objects.xref.iter().find_map(|(id,(loc,_))|match loc {Location::File(offset) if *offset as f64==ho+header as f64=>Some(*id),_=>None});
    let Some(id)=hint_id else{return Some(out);};
    let (node,mut cursor)=source.objects.object(id)?;cursor.skip();
    if !cursor.0.starts_with(b"stream"){return Some(out);}
    let shared_offset=node.get(b"S").and_then(|v|source.objects.resolve(v)).and_then(|v|v.number()).unwrap_or(0.) as usize;
    let outline_offset=node.get(b"O").and_then(|v|source.objects.resolve(v)).and_then(|v|v.number()).map(|n|n as usize);
    let data=source.objects.stream(&node,cursor)?;
    let data=source.objects.decode(&node,data.into())?;
    if data.is_empty(){return Some(out);}
    let adjusted=|n:usize|if n as f64>=ho{n as f64+hl}else{n as f64};
    out.push_str("\nPage Offsets Hint Table\n\n");
    let mut bits=Bits::new(&data,0)?;let mut fields=Vec::new();
    for (key,width) in [("min_nobjects",32),("first_page_offset",32),("nbits_delta_nobjects",16),("min_page_length",32),("nbits_delta_page_length",16),("min_content_offset",32),("nbits_delta_content_offset",16),("min_content_length",32),("nbits_delta_content_length",16),("nbits_nshared_objects",16),("nbits_shared_identifier",16),("nbits_shared_numerator",16),("shared_denominator",16)]{
        let value=bits.read(width)?;fields.push(value);writeln!(out,"{key}: {}",if key=="first_page_offset"{adjusted(value)}else{value as f64}).ok()?;
    }
    let n=source.pages.len();let f=&fields;
    let mut objects=bits.column(n,f[2])?;let mut lengths=bits.column(n,f[4])?;let mut counts=bits.column(n,f[9])?;
    let mut scan=counts;let mut total=0usize;for _ in 0..n{total=total.checked_add(scan.read(f[9])?)?;}
    let mut identifiers=bits.column(total,f[10])?;let mut numerators=bits.column(total,f[11])?;
    let mut offsets=bits.column(n,f[6])?;let mut contents=bits.column(n,f[8])?;
    let limit=crate::budget::ShellLimits::default().max_output_bytes;
    for i in 0..n{
        writeln!(out,"Page {i}:\n  nobjects: {}\n  length: {}\n  content_offset: {}\n  content_length: {}",f[0]+objects.read(f[2])?,f[3]+lengths.read(f[4])?,f[5]+offsets.read(f[6])?,f[7]+contents.read(f[8])?).ok()?;
        let count=counts.read(f[9])?;writeln!(out,"  nshared_objects: {count}").ok()?;
        if count>limit.saturating_sub(out.len())/30{return None;}
        for j in 0..count{writeln!(out,"    identifier {j}: {}\n    numerator {j}: {}",identifiers.read(f[10])?,numerators.read(f[11])?).ok()?;}
        if out.len()>limit{return None;}
    }
    out.push_str("\nShared Objects Hint Table\n\n");
    let mut bits=Bits::new(&data,shared_offset)?;let mut fields=Vec::new();
    for (key,width) in [("first_shared_obj",32),("first_shared_offset",32),("nshared_first_page",32),("nshared_total",32),("nbits_nobjects",16),("min_group_length",32),("nbits_delta_group_length",16)]{
        let value=bits.read(width)?;fields.push(value);writeln!(out,"{key}: {}",if key=="first_shared_offset"{adjusted(value)}else{value as f64}).ok()?;
    }
    let f=&fields;let n=f[3];
    if n>limit.saturating_sub(out.len())/30{return None;}
    let mut lengths=bits.column(n,f[6])?;let mut signatures=bits.column(n,1)?;let mut scan=signatures;
    for _ in 0..n{if scan.read(1)?!=0{bits.column(4,32)?;}}
    let mut counts=bits.column(n,f[4])?;
    for i in 0..n{
        writeln!(out,"Shared Object {i}:\n  group length: {}",f[5]+lengths.read(f[6])?).ok()?;
        if signatures.read(1)?!=0{out.push_str("  signature present\n");}
        let count=counts.read(f[4])?;if count!=0{writeln!(out,"  nobjects: {}",count+1).ok()?;}
    }
    if let Some(offset)=outline_offset{
        let mut bits=Bits::new(&data,offset)?;
        let first=bits.read(32)?;let offset=bits.read(32)?;let count=bits.read(32)?;let length=bits.read(32)?;
        if count!=0{writeln!(out,"\nOutlines Hint Table\n\nfirst_object: {first}\nfirst_object_offset: {}\nnobjects: {count}\ngroup_length: {length}",adjusted(offset)).ok()?;}
    }
    assignments(source,&mut out)?;
    (out.len()<=limit).then_some(out)
}

#[derive(Clone,Copy,PartialEq,Eq,PartialOrd,Ord)]
enum Category{Root,Open,FirstShared,FirstPrivate,Shared,Private,ThumbShared,ThumbPrivate,Pages,OutlinesRoot,Outlines,Other}
struct Placement{usage:BTreeMap<usize,(Category,isize)>,pages:Vec<usize>,thumbs:BTreeMap<isize,usize>}
impl Placement{
    fn assign(&mut self,id:usize,category:Category,page:isize){
        use Category::*;
        let Some(&(old,old_page))=self.usage.get(&id) else{self.usage.insert(id,(category,page));return;};
        let min=old.min(category);let max=old.max(category);
        let merged=if min==FirstPrivate && matches!(max,Private|Shared){FirstShared}
            else if min==Private && max==Private && old_page!=page{Shared}
            else if min==ThumbPrivate && max==ThumbPrivate && old_page!=page{ThumbShared}else{min};
        self.usage.insert(id,(merged,if old_page<=0||page<=0{old_page.max(page)}else{old_page.min(page)}));
    }
    fn walk<'a>(&mut self,objects:&mut Objects<'a>,start:Value<'a>,category:Category,page:isize,page_dict:Option<Value<'a>>)->Option<()>{
        use Category::*;
        let mut seen=BTreeSet::new();let mut pending=vec![(start,category,true)];
        while let Some((mut node,kind,top))=pending.pop(){
            let mut is_page=false;
            if let Value::Ref(id)=node{
                if !seen.insert(id.0){continue;}
                let Some((object,_))=objects.object(id) else{continue;};
                let number=match objects.xref.get(&id)?.0{Location::Member{container,..}=>container,_=>id.0};
                node=if top{page_dict.as_ref().unwrap_or(&object).clone()}else{object};
                let ty=node.get(b"Type").and_then(Value::word);is_page=ty==Some(b"/Page");
                if is_page&&!top || page>=0&&category!=ThumbPrivate&&ty==Some(b"/Pages"){continue;}
                self.assign(number,if top&&kind==Outlines{OutlinesRoot}else{kind},page);
                if top&&is_page&&page>=0{self.pages[page as usize]=number;}
                if kind==ThumbPrivate{self.thumbs.entry(page).or_insert(number);}
            }
            match node{
                Value::Array(items)=>pending.extend(items.into_iter().map(|v|(v,kind,false))),
                Value::Dict(entries)=>pending.extend(entries.into_iter().filter(|(k,_)|!is_page||k.as_ref()!=b"Parent").map(|(k,v)|(v,if is_page&&k.as_ref()==b"Thumb"{ThumbPrivate}else{kind},false))),
                _=>(),
            }
        }
        Some(())
    }
    fn select(&self,category:Category,page:Option<isize>)->Vec<usize>{self.usage.iter().filter(|(_,v)|v.0==category&&page.is_none_or(|p|p==v.1)).map(|(&id,_)|id).collect()}
}

fn assignments(source:&mut PageSource<'_>,out:&mut String)->Option<()>{
    use Category::*;
    let mut state=Placement{usage:BTreeMap::new(),pages:vec![0;source.pages.len()],thumbs:BTreeMap::new()};
    for (i,id) in source.pages.clone().into_iter().enumerate(){
        let mut page=source.objects.page_dict(id,&source.tree)?;
        for key in [b"Resources".as_slice(),b"MediaBox",b"CropBox",b"Rotate"]{
            if page.get(key).is_some(){continue;}
            let mut parent=page.get(b"Parent").cloned();let mut seen=BTreeSet::new();
            while let Some(id)=parent.as_ref().and_then(Value::reference){
                if !seen.insert(id){break;}
                let dict=source.objects.page_dict(id,&source.tree)?;
                if let Some(value)=dict.get(key){if let Value::Dict(fields)=&mut page{fields.push((key.into(),value.clone()));}break;}
                parent=dict.get(b"Parent").cloned();
            }
        }
        state.walk(&mut source.objects,Value::Ref(id),if i==0{FirstPrivate}else{Private},i as isize,Some(page))?;
    }
    if let Value::Dict(entries)=source.trailer.clone(){for (key,value) in entries{if !matches!(key.as_ref(),b"Root"|b"Prev"|b"XRefStm"){state.walk(&mut source.objects,value,if key.as_ref()==b"Encrypt"{Open}else{Other},-1,None)?;}}}
    if let Value::Dict(entries)=source.catalog.clone(){for (key,value) in entries{
        let kind=match key.as_ref(){b"ViewerPreferences"|b"PageMode"|b"Threads"|b"OpenAction"|b"AcroForm"=>Open,b"Pages"=>Pages,b"Outlines"=>Outlines,_=>Other};
        state.walk(&mut source.objects,value,kind,-1,None)?;
    }}
    let root=source.trailer.get(b"Root")?.reference()?;
    let root=match source.objects.xref.get(&root)?.0{Location::Member{container,..}=>container,_=>root.0};state.assign(root,Root,-1);
    fn first(mut ids:Vec<usize>,id:usize)->Vec<usize>{if let Some(index)=ids.iter().position(|n|*n==id){ids.remove(index);ids.insert(0,id);}ids}
    let outlines=state.select(OutlinesRoot,None).into_iter().chain(state.select(Outlines,None)).collect::<Vec<_>>();
    let show=source.catalog.get(b"PageMode").cloned().and_then(|v|source.objects.resolve(&v)).is_some_and(|v|v.word()==Some(b"/UseOutlines"));
    let parts=[
        ("4 (root, document open)",state.select(Root,None).into_iter().chain(state.select(Open,None)).collect::<Vec<_>>()),
        ("6 (first page)",first(state.select(FirstPrivate,None),state.pages.first().copied().unwrap_or(0)).into_iter().chain(state.select(FirstShared,None)).chain(if show{outlines.clone()}else{vec![]}).collect()),
        ("7 (other pages, private)",state.pages.iter().enumerate().flat_map(|(i,id)|first(state.select(Private,Some(i as isize)),*id)).collect()),
        ("8 (other pages, shared)",state.select(Shared,None)),
        ("9 (everything else)",state.select(Pages,None).into_iter().chain(state.pages.iter().enumerate().flat_map(|(i,_)|first(state.select(ThumbPrivate,Some(i as isize)),*state.thumbs.get(&(i as isize)).unwrap_or(&0)))).chain(state.select(ThumbShared,None)).chain(if show{vec![]}else{outlines}).chain(state.select(Other,None)).collect()),
    ];
    out.push_str("\nComputed Linearization Part Assignments\n\n");
    for (label,ids) in parts{
        write!(out,"part {label}:").ok()?;if ids.is_empty(){out.push_str(" none\n");continue;}
        let mut i=0;let mut ranges=0;
        while i<ids.len(){let start=ids[i];let mut end=start;while ids.get(i+1)==Some(&(end+1)){i+=1;end+=1;}
            out.push_str(if ranges%10==0{"\n "}else{", "});write!(out,"{start}").ok()?;if end!=start{write!(out,"-{end}").ok()?;}ranges+=1;i+=1;
        }
        out.push('\n');
    }
    Some(())
}
