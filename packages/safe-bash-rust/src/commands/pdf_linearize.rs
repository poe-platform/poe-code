// Annex F layout shared with the JavaScript writer: a front xref, page sections,
// byte-aligned hint columns, and a complete final xref.
use super::super::{Cursor, Objects, Value};
use super::{INVALID, TOO_LARGE, encode, write_xref};
use std::{collections::{BTreeMap, BTreeSet}, io::Write, fmt::Write as _};

struct Object<'a> { value: Value<'a>, stream: Option<&'a [u8]> }

fn resolve<'r,'a>(mut value: &'r Value<'a>, objects: &'r BTreeMap<usize,Object<'a>>) -> Option<&'r Value<'a>> {
    let mut seen = BTreeSet::new();
    while let Value::Ref((id, _)) = value {
        if !seen.insert(*id) { return None; }
        value = &objects.get(id)?.value;
    }
    Some(value)
}

fn reachable(start: &Value<'_>, objects: &BTreeMap<usize,Object<'_>>, inherited: &BTreeMap<usize,Value<'_>>, excluded: &BTreeSet<usize>, page: bool) -> Vec<usize> {
    let mut found = Vec::new();
    let mut seen = BTreeSet::new();
    let mut pending = vec![(start.clone(),true)];
    while let Some((mut node,top)) = pending.pop() {
        if let Value::Ref((id,_)) = node {
            if seen.contains(&id) || excluded.contains(&id) { continue; }
            let Some(object) = objects.get(&id) else { continue; };
            node = inherited.get(&id).unwrap_or(&object.value).clone();
            if matches!(node.get(b"Type").and_then(Value::word),Some(b"/Page")) && !top
                || page && matches!(node.get(b"Type").and_then(Value::word),Some(b"/Pages")) { continue; }
            seen.insert(id); found.push(id);
        }
        match node {
            Value::Array(items) => pending.extend(items.into_iter().map(|v|(v,false))),
            Value::Dict(entries) => {
                let is_page=entries.iter().any(|(k,v)|k.as_ref()==b"Type" && v.word()==Some(b"/Page"));
                pending.extend(entries.into_iter().filter(|(k,_)|!is_page || !matches!(k.as_ref(),b"Parent"|b"Thumb")).map(|(_,v)|(v,false)));
            }
            _ => (),
        }
    }
    found
}

fn remap(value: &Value<'_>, numbers: &BTreeMap<usize,usize>, depth: usize) -> Result<Value<'static>,String> {
    if depth>128 { return Err(INVALID.into()); }
    Ok(match value {
        Value::Ref((id,_)) => numbers.get(id).map_or_else(||Value::Word(b"null".as_slice().into()),|n|Value::Ref((*n,0))),
        Value::Array(items) => Value::Array(items.iter().map(|v|remap(v,numbers,depth+1)).collect::<Result<_,_>>()?),
        Value::Dict(entries) => {
            let tree=value.get(b"Type").and_then(Value::word)==Some(b"/Pages");
            Value::Dict(entries.iter().filter(|(k,_)|!tree || !matches!(k.as_ref(),b"Resources"|b"MediaBox"|b"CropBox"|b"Rotate"))
                .map(|(k,v)|Ok((k.clone().into_owned().into(),remap(v,numbers,depth+1)?))).collect::<Result<_,String>>()?)
        }
        value=>value.clone().into_owned(),
    })
}

fn append(out: &mut Vec<u8>, data: &[u8], limit: usize) -> Result<(),String> {
    if data.len()>limit.saturating_sub(out.len()) { return Err(TOO_LARGE.into()); }
    out.extend_from_slice(data); Ok(())
}

pub(in super::super) fn finish_classic(out:Vec<u8>, rows:Vec<(u8,usize,usize)>, trailer:&[u8], root:usize, generate:bool, limit:usize) -> Result<Vec<u8>,String> {
    if !out.windows(11).any(|w|w==b"/Linearized") { return write_xref(out,rows,trailer,limit); }
    let mut objects=BTreeMap::new(); let mut tokens=1_000_000;
    let mut reader=Objects::new(&out); let mut marker=false;
    for (id,&(ty,offset,_)) in rows.iter().enumerate().filter(|(_,r)|r.0==1) {
        let _=ty;
        let mut cursor=Cursor(out.get(offset..).ok_or(INVALID)?);
        cursor.object_header().ok_or(INVALID)?;
        let value=cursor.value(0,&mut tokens,true).ok_or(INVALID)?;
        cursor.skip();
        let stream=if cursor.0.starts_with(b"stream") { Some(reader.stream(&value,cursor).ok_or(INVALID)?) } else { None };
        if stream.is_none() && value.get(b"Linearized").is_some() { marker=true; }
        objects.insert(id,Object{value,stream});
    }
    if !marker { return write_xref(out,rows,trailer,limit); }
    let mut wrapper=b"<<\n".to_vec(); wrapper.extend_from_slice(trailer); wrapper.extend_from_slice(b">>");
    let trailer=Cursor(&wrapper).value(0,&mut tokens,true).ok_or(INVALID)?;
    let catalog=&objects.get(&root).ok_or(INVALID)?.value;
    let mut inherited=BTreeMap::new(); let mut pages=Vec::new(); let mut visited=BTreeSet::new();
    let mut pending=vec![(catalog.get(b"Pages").ok_or(INVALID)?.clone(),Vec::new())];
    while let Some((node,mut attrs))=pending.pop() {
        let id=node.reference().map(|v|v.0);
        if id.is_some_and(|id|!visited.insert(id)) { continue; }
        let Some(Value::Dict(entries))=resolve(&node,&objects) else { continue; };
        let value=Value::Dict(entries.clone());
        for key in [b"Resources".as_slice(),b"MediaBox",b"CropBox",b"Rotate"] {
            if let Some(value)=value.get(key) {
                attrs.retain(|(name,_)|name!=key); attrs.push((key.to_vec(),value.clone()));
            }
        }
        if value.get(b"Type").and_then(Value::word)==Some(b"/Page") && let Some(id)=id {
            pages.push(id);
            let mut merged:Vec<_>=entries.iter().filter(|(k,_)|!attrs.iter().any(|(a,_)|a.as_slice()==k.as_ref())).cloned().collect();
            merged.extend(attrs.into_iter().map(|(k,v)|(k.into(),v)));
            inherited.insert(id,Value::Dict(merged));
        } else if let Some(Value::Array(kids))=value.get(b"Kids").and_then(|v|resolve(v,&objects)) {
            pending.extend(kids.iter().rev().map(|v|(v.clone(),attrs.clone())));
        }
    }
    if pages.is_empty() { return Err("Cannot linearize a PDF with no pages".into()); }
    let excluded:BTreeSet<_>=objects.iter().filter(|(_,o)|o.value.get(b"Linearized").is_some()
        || o.stream.is_some() && matches!(o.value.get(b"Type").and_then(Value::word),Some(b"/Hint"|b"/XRef"|b"/ObjStm"))).map(|(id,_)|*id).collect();
    let mut open=vec![root];
    for key in [b"ViewerPreferences".as_slice(),b"Threads",b"OpenAction",b"AcroForm"] {
        if let Some(node)=catalog.get(key) { for id in reachable(node,&objects,&inherited,&excluded,false) { if !open.contains(&id) {open.push(id);} } }
    }
    let mut uses:BTreeMap<usize,Vec<usize>>=BTreeMap::new(); let mut dependencies=Vec::new();
    for (index,&page) in pages.iter().enumerate() {
        let found=reachable(&Value::Ref((page,0)),&objects,&inherited,&excluded,true);
        for &id in &found { if !open.contains(&id) { uses.entry(id).or_default().push(index); } }
        dependencies.push(found);
    }
    let mut groups:Vec<_>=pages.iter().map(|&p|vec![p]).collect(); let mut other_shared=Vec::new();
    for &id in objects.keys() {
        let Some(owners)=uses.get(&id) else {continue;};
        if id==pages[owners[0]] {continue;}
        if owners[0]==0 || owners.len()==1 { groups[owners[0]].push(id); } else { other_shared.push(id); }
    }
    let outline_group=catalog.get(b"Outlines").map(|v|reachable(v,&objects,&inherited,&excluded,false)).unwrap_or_default()
        .into_iter().filter(|id|!open.contains(id) && !uses.contains_key(id)).collect::<Vec<_>>();
    if catalog.get(b"PageMode").and_then(Value::word)==Some(b"/UseOutlines") { groups[0].extend(&outline_group); }
    let placed:BTreeSet<_>=open.iter().chain(groups.iter().flatten()).chain(&other_shared).chain(&outline_group).copied().collect();
    let rest=outline_group.iter().filter(|id|!groups[0].contains(id)).copied()
        .chain(objects.keys().filter(|id|!placed.contains(id) && !excluded.contains(id)).copied()).collect::<Vec<_>>();
    let order:Vec<_>=open.iter().chain(groups.iter().flatten()).chain(&other_shared).chain(&rest).copied().collect();
    let mut numbers:BTreeMap<_,_>=order.iter().enumerate().map(|(i,id)|(*id,i+3)).collect();
    let mut packed=BTreeMap::new();
    if generate && trailer.get(b"Encrypt").is_none() {
        for &id in &rest {if !outline_group.contains(&id) && objects[&id].stream.is_none(){packed.insert(id,0);}}
    }
    let mut size=order.len().checked_add(3).ok_or(TOO_LARGE)?;
    let mut front_xref_number=0;let mut main_xref_number=0;
    if !packed.is_empty(){
        let mut number=3;
        for &id in &order {if !packed.contains_key(&id){numbers.insert(id,number);number+=1;}}
        for container in packed.values_mut(){*container=number;number+=1;}
        front_xref_number=number;number+=1;main_xref_number=number;number+=1;
        for &id in packed.keys(){numbers.insert(id,number);number+=1;}
        size=number;
    }
    if size>limit/20 {return Err(TOO_LARGE.into());}
    let shared:Vec<_>=groups[0].iter().chain(&other_shared).copied().collect();
    let shared_refs:Vec<Vec<usize>>=dependencies.iter().enumerate().map(|(index,ids)|if index==0 {vec![]} else {
        ids.iter().filter(|id|uses.get(id).is_some_and(|owners|owners.len()>1)).filter_map(|id|shared.iter().position(|v|v==id)).collect()
    }).collect();
    let mut bodies=BTreeMap::new(); let mut lengths=BTreeMap::new(); let mut retained=0usize;
    for &id in &order {
        let object=&objects[&id]; let mut body=Vec::new();
        encode(&remap(inherited.get(&id).unwrap_or(&object.value),&numbers,0)?,&mut body)?;
        if let Some(data)=object.stream { append(&mut body,b"\nstream\n",limit)?;append(&mut body,data,limit)?;append(&mut body,b"\nendstream",limit)?; }
        if packed.contains_key(&id){
            let head=format!("{} 0\n",numbers[&id]);let mut data=head.as_bytes().to_vec();data.extend_from_slice(&body);
            body=format!("<<\n/Type /ObjStm\n/N 1\n/First {}\n/Length {}\n>>\nstream\n",head.len(),data.len()).into_bytes();
            append(&mut body,&data,limit)?;append(&mut body,b"\nendstream",limit)?;
        }
        retained=retained.checked_add(body.len()).filter(|n|*n<=limit).ok_or(TOO_LARGE)?;
        lengths.insert(id,format!("{} 0 obj\n",packed.get(&id).unwrap_or(&numbers[&id])).len()+body.len()+9);
        bodies.insert(id,body);
    }
    let mut trailer_fields=Vec::new();
    for key in [b"Root".as_slice(),b"Info",b"Encrypt",b"ID"] { if let Some(value)=trailer.get(key) { trailer_fields.push((key.to_vec(),remap(value,&numbers,0)?)); } }
    let encrypted=trailer.get(b"Encrypt").is_some();
    let header_end=out.iter().position(|&b|b==b'\n').ok_or(INVALID)?;
    let mut header=out[..=header_end].to_vec();header.extend_from_slice(b"%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n");
    let linear=|total,ho,hl,end,xref|format!("<<\n/Linearized 1\n/L {total:010}\n/H [ {ho:010} {hl:010} ]\n/O {}\n/E {end:010}\n/N {}\n/T {:010}\n>>",numbers[&pages[0]],pages.len(),if packed.is_empty(){xref+format!("xref\n0 {size}\n").len()-1}else{xref}).into_bytes();
    let front_xref=header.len()+8+linear(0,0,0,0,0).len()+9;
    let page_hint_size=36+pages.len()*16+shared_refs.iter().map(|v|v.len()*4).sum::<usize>();
    let outline_offset=page_hint_size+24+shared.len()*4+shared.len().div_ceil(8);
    let hint_size=outline_offset+usize::from(!outline_group.is_empty())*16;
    if hint_size>limit {return Err(TOO_LARGE.into());}
    let mut hint_dict=format!("<<\n/Type /Hint\n/Length {hint_size}\n/S {page_hint_size}\n");
    if !outline_group.is_empty(){writeln!(hint_dict,"/O {outline_offset}").unwrap();}
    if encrypted { hint_dict.push_str("/Filter /Crypt\n/DecodeParms <<\n/Type /CryptFilterDecodeParms\n/Name /Identity\n>>\n"); }
    hint_dict.push_str(">>");
    let hint_len=8+hint_dict.len()+8+hint_size+10+9;
    let xref=|offsets:&BTreeMap<usize,usize>,ho:usize,main:usize,front:bool|->Result<Vec<u8>,String>{
        let mut fields=format!("<<\n/Size {size}\n").into_bytes();
        for (key,value) in &trailer_fields {fields.push(b'/');fields.extend_from_slice(key);fields.push(b' ');encode(value,&mut fields)?;fields.push(b'\n');}
        if front {writeln!(fields,"/Prev {main:010}").unwrap();}
        if !packed.is_empty(){
            let mut data=vec![0u8;size.checked_mul(7).filter(|n|*n<=limit).ok_or(TOO_LARGE)?];
            let mut entry=|id:usize,kind:u8,offset:usize,index:usize|->Result<(),String>{
                let offset=u32::try_from(offset).map_err(|_|TOO_LARGE)?;let index=u16::try_from(index).map_err(|_|TOO_LARGE)?;
                data[id*7]=kind;data[id*7+1..id*7+5].copy_from_slice(&offset.to_be_bytes());data[id*7+5..id*7+7].copy_from_slice(&index.to_be_bytes());Ok(())
            };
            entry(0,0,0,65535)?;entry(1,1,header.len(),0)?;entry(2,1,ho,0)?;
            for &id in &order{if let Some(&container)=packed.get(&id){entry(numbers[&id],2,container,0)?;entry(container,1,*offsets.get(&id).unwrap_or(&0),0)?;}
                else{entry(numbers[&id],1,*offsets.get(&id).unwrap_or(&0),0)?;}}
            entry(front_xref_number,1,front_xref,0)?;entry(main_xref_number,1,main,0)?;
            write!(fields,"/Type /XRef\n/W [ 1 4 2 ]\n/Length {}\n>>",data.len()).unwrap();
            let mut bytes=format!("{} 0 obj\n",if front{front_xref_number}else{main_xref_number}).into_bytes();
            bytes.extend_from_slice(&fields);bytes.extend_from_slice(b"\nstream\n");bytes.extend_from_slice(&data);bytes.extend_from_slice(b"\nendstream\nendobj\n\n");
            write!(bytes,"\nstartxref\n{}\n%%EOF\n",if front{0}else{front_xref}).unwrap();return Ok(bytes);
        }
        let mut bytes=format!("xref\n0 {size}\n0000000000 65535 f \n").into_bytes();
        for number in 1..size { let offset=if number==1{header.len()}else if number==2{ho}else{*offsets.get(&order[number-3]).unwrap_or(&0)};writeln!(bytes,"{offset:010} 00000 n ").unwrap(); }
        bytes.extend_from_slice(b"trailer\n");bytes.extend_from_slice(&fields);
        write!(bytes,">>\n\nstartxref\n{}\n%%EOF\n",if front{0}else{front_xref}).unwrap();Ok(bytes)
    };
    let mut offsets=BTreeMap::new(); let mut offset=front_xref+xref(&offsets,0,0,true)?.len();
    for &id in &open {offsets.insert(id,offset);offset+=lengths[&id];}
    let hint_offset=offset; offset+=hint_len; let mut first_end=0;
    for &id in order.iter().filter(|id|!open.contains(id)){offsets.insert(id,offset);offset+=lengths[&id];if Some(&id)==groups[0].last(){first_end=offset;}}
    let main_xref=offset; let tail=xref(&offsets,hint_offset,main_xref,false)?;let total=main_xref.checked_add(tail.len()).filter(|n|*n<=limit).ok_or(TOO_LARGE)?;
    let mut hints=vec![0;hint_size];let mut at=0;
    fn number(bytes:&mut[u8],at:&mut usize,value:usize,width:usize)->Result<(),String>{
        let number=u32::try_from(value).map_err(|_|TOO_LARGE)?;
        let part=bytes.get_mut(*at..*at+width).ok_or(TOO_LARGE)?;part.copy_from_slice(&number.to_be_bytes()[4-width..]);*at+=width;Ok(())
    }
    let adjusted=|n:usize|if n>=hint_offset{n-hint_len}else{n};
    let page_lengths:Vec<usize>=groups.iter().map(|g|g.iter().map(|id|lengths[id]).sum()).collect();
    let min_objects=groups.iter().map(Vec::len).min().ok_or(INVALID)?;let min_length=*page_lengths.iter().min().ok_or(INVALID)?;
    let min_shared=shared.iter().map(|id|lengths[id]).min().ok_or(INVALID)?;
    for (v,w) in [(min_objects,4),(adjusted(offsets[&pages[0]]),4),(32,2),(min_length,4),(32,2),(0,4),(0,2),(min_length,4),(32,2),(32,2),(32,2),(0,2),(1,2)]{number(&mut hints,&mut at,v,w)?;}
    for g in &groups{number(&mut hints,&mut at,g.len()-min_objects,4)?;}
    for &len in &page_lengths{number(&mut hints,&mut at,len-min_length,4)?;}
    for refs in &shared_refs{number(&mut hints,&mut at,refs.len(),4)?;}
    for &id in shared_refs.iter().flatten(){number(&mut hints,&mut at,id,4)?;}
    for &len in &page_lengths{number(&mut hints,&mut at,len-min_length,4)?;}
    at=page_hint_size;
    for (v,w) in [(other_shared.first().map_or(0,|id|numbers[id]),4),(other_shared.first().map_or(0,|id|adjusted(offsets[id])),4),(groups[0].len(),4),(shared.len(),4),(0,2),(min_shared,4),(32,2)]{number(&mut hints,&mut at,v,w)?;}
    for id in &shared{number(&mut hints,&mut at,lengths[id]-min_shared,4)?;}
    if let Some(first)=outline_group.first(){at=outline_offset;for value in [numbers[first],adjusted(offsets[first]),outline_group.len(),outline_group.iter().map(|id|lengths[id]).sum()]{number(&mut hints,&mut at,value,4)?;}}
    let mut result=header.clone();
    append(&mut result,b"1 0 obj\n",limit)?;append(&mut result,&linear(total,hint_offset,hint_len,first_end,main_xref),limit)?;append(&mut result,b"\nendobj\n\n",limit)?;
    append(&mut result,&xref(&offsets,hint_offset,main_xref,true)?,limit)?;
    let object=|id:usize,result:&mut Vec<u8>|->Result<(),String>{append(result,format!("{} 0 obj\n",packed.get(&id).unwrap_or(&numbers[&id])).as_bytes(),limit)?;append(result,&bodies[&id],limit)?;append(result,b"\nendobj\n\n",limit)};
    for &id in &open{object(id,&mut result)?;}
    append(&mut result,b"2 0 obj\n",limit)?;append(&mut result,hint_dict.as_bytes(),limit)?;append(&mut result,b"\nstream\n",limit)?;append(&mut result,&hints,limit)?;append(&mut result,b"\nendstream\nendobj\n\n",limit)?;
    for &id in order.iter().filter(|id|!open.contains(id)){object(id,&mut result)?;}
    append(&mut result,&tail,limit)?;Ok(result)
}
