use super::{ffmpeg_pcm::Format, ffmpeg_wave::{Input, Wave}, InputTime, mp4::mux::Remux};
use std::collections::BTreeMap;

pub(super) fn pcm(encoding: u32) -> Option<Format> {
    Some(match encoding {
        1 => Format::Mulaw, 2 => Format::Signed(8,false), 3 => Format::Signed(16,true),
        4 => Format::Signed(24,true), 5 => Format::Signed(32,true),
        6 => Format::Float(32,true), 7 => Format::Float(64,true), 27 => Format::Alaw,
        _ => return None,
    })
}
pub(super) fn encoding(format: Format) -> Result<u32, String> {
    [1,2,3,4,5,6,7,27].into_iter().find(|&n|pcm(n)==Some(format))
        .ok_or_else(||format!("Unsupported AU audio codec 'pcm_{}'",format.name()))
}
pub(super) struct Document<'a> {
    pub rate: u32, pub channels: u32, pub encoding: u32, pub size: u32,
    pub offset: usize, pub data: &'a [u8], pub tags: BTreeMap<String,String>,
}
impl<'a> Document<'a> {
    pub fn read(bytes: &'a [u8], limit: usize) -> Result<Self, &'static str> {
        if bytes.len()<24 || !bytes.starts_with(b".snd") {return Err("Invalid AU header");}
        if bytes.len()>limit {return Err("input byte limit exceeded");}
        let word=|i|u32::from_be_bytes(bytes[i..i+4].try_into().unwrap());
        let encoding=word(12);
        if pcm(encoding).is_none() && !matches!(encoding,23..=26) {return Err("Unsupported AU audio encoding");}
        let offset=word(4) as i32;
        if offset==0 || i64::from(offset)>bytes.len() as i64 {return Err("Invalid AU data bounds");}
        let offset=offset.max(24) as usize;
        let rate=word(16); let channels=word(20);
        if rate>i32::MAX as u32 {return Err("Invalid AU sample rate");}
        if rate==0 || channels==0 || channels>65535 {return Err("Invalid AU sample rate or channel count");}
        let annotation=&bytes[24..offset];
        let annotation=&annotation[..annotation.iter().position(|&b|b==0).unwrap_or(annotation.len())];
        let mut tags=BTreeMap::new();
        for line in String::from_utf8_lossy(annotation).split('\n') {
            if let Some((key,value))=line.split_once('=') {
                let key=key.to_ascii_lowercase();
                if matches!(key.as_str(),"title"|"artist"|"album"|"track"|"genre") {tags.insert(key,value.to_owned());}
            }
        }
        Ok(Self{rate,channels,encoding,size:word(8),offset,data:&bytes[offset..],tags})
    }
    fn bits(&self) -> u16 {
        pcm(self.encoding).map_or_else(||match self.encoding {25=>3,26=>5,_=>4},Format::bits)
    }
    pub fn ticks(&self) -> u64 {
        let bytes=if self.size==u32::MAX {self.data.len() as u64} else {u64::from(self.size)};
        bytes*8/(u64::from(self.channels)*u64::from(self.bits()))
    }
    pub fn render(&self, seek: InputTime, opts: &Remux) -> Result<Vec<u8>, String> {
        if self.size == 0 { return Err("Invalid AU data size".into()); }
        let data = self.data;
        let decoded;
        let (format,data,channels)=if let Some(format)=pcm(self.encoding) {(format,data,self.channels)} else {
            if opts.audio_codec==Some("copy") {return Err("AU ADPCM stream copy is not supported".into());}
            if self.encoding!=24 && self.channels!=1 {return Err("G.726 requires a mono channel count".into());}
            decoded=if self.encoding==24 {super::g722::decode(data,opts.limit)?} else {super::g726::decode(data,self.bits() as u8,true,data.len().max(1),0,0,opts.limit)?};
            (Format::Signed(16,false),decoded.as_slice(),1)
        };
        let mut wave=Wave::raw(format,data,self.rate,channels)?;
        wave.packet_frames=Some((self.rate as usize/25).clamp(1,1024));
        Input::Wave(wave).render(seek,opts)
    }
    pub fn report(&self, filename: &str, seekable: bool, mut opts: super::media_probe::ProbeOptions<'_>) -> Result<String, &'static str> {
        use super::super::structured::JVal::{Number,Str,Object};
        use super::media_probe::{report,format_row,selected};
        let bits=self.bits(); let ticks=self.ticks(); let duration=ticks as f64/f64::from(self.rate);
        let adpcm=pcm(self.encoding).is_none();
        let packet_size=if adpcm {self.data.len().max(1)} else {(self.rate as usize/25).clamp(1,1024)*self.channels as usize*usize::from(bits/8)};
        let packets=self.data.len().div_ceil(packet_size);
        let counts=(opts.counts.0||opts.show.contains("frame"),opts.counts.1||opts.show.contains("packet"));
        if opts.show.is_empty()&&opts.entries.is_none(){opts.entries=Some(Default::default());}
        if opts.show.contains("frame")&&opts.show.contains("packet"){opts.show.remove("frame");opts.show.remove("packet");opts.show.insert("packet_frame");}
        let enabled=selected(opts.select,"audio",0,0);
        let codec=pcm(self.encoding).map_or_else(||if self.encoding==24 {"adpcm_g722".into()}else{"adpcm_g726le".into()},|f|format!("pcm_{}",f.name()));
        let sample_fmt=match self.encoding {1|3|27=>"s16",2=>"u8",4|5=>"s32",6=>"flt",7=>"dbl",_=>"fltp"};
        let bit_rate=if duration>0. {(self.data.len() as f64*8./duration).round().to_string()}else{"0".into()};
        let unknown=self.size==u32::MAX;
        report(opts,|section|match section {
            "stream" if enabled=>{
                let long=if self.encoding==3 {"PCM signed 16-bit big-endian"}else{&codec};
                let mut disposition=super::media_probe::disposition(true);
                disposition.extend(["non_diegetic","captions","descriptions","metadata","dependent","still_image","multilayer"].map(|key|(key.into(),Number(0.,None))));
                let mut row=vec![
                    ("index",Number(0.,None)),("id",Str("0x1".into())),("codec_name",Str(codec.clone())),("codec_long_name",Str(long.into())),("codec_type",Str("audio".into())),
                    ("codec_tag_string",Str(format!("[{}][0][0][0]",self.encoding))),("codec_tag",Str(format!("0x{:04x}",self.encoding))),
                    ("sample_fmt",Str(sample_fmt.into())),("sample_rate",Str(self.rate.to_string())),("channels",Number(f64::from(self.channels),None)),("bits_per_sample",Number(f64::from(bits),None)),
                    ("r_frame_rate",Str("0/0".into())),("avg_frame_rate",Str("0/0".into())),("time_base",Str(format!("1/{}",self.rate))),("start_pts",Number(0.,None)),("start_time",Str("0.000000".into())),
                    ("duration_ts",Number(ticks as f64,None)),("duration",Str(format!("{duration:.6}"))),("bit_rate",Str(bit_rate.clone())),
                    ("disposition",Object(disposition)),("tags",Object(vec![("language".into(),Str("und".into()))])),
                ];
                if unknown {row.retain(|(k,_)|!(!seekable&&*k=="duration" || (!seekable||self.data.is_empty())&&*k=="duration_ts"));}
                if matches!(self.encoding,4|5) {row.push(("bits_per_raw_sample",Str(bits.to_string())));}
                if counts.0&&packets>0 {row.push(("nb_read_frames",Str(packets.to_string())));}
                if counts.1&&packets>0 {row.push(("nb_read_packets",Str(packets.to_string())));}
                Box::new(std::iter::once(row))
            }
            "format"=>{
                let tags=["title","artist","album","genre","track"].into_iter().filter_map(|key|self.tags.get(key).filter(|v|!v.is_empty()).map(|v|(key.into(),Str(v.clone())))).collect();
                let mut row=format_row(filename,self.offset+self.data.len(),("au","Sun AU"),1,duration,tags);
                row.insert(3,("nb_stream_groups",Number(0.,None)));
                if !seekable {row.retain(|(k,_)|!matches!(*k,"size"|"bit_rate")&&!(unknown&&*k=="duration")); if unknown {row.insert(row.len()-2,("bit_rate",Str(bit_rate.clone())));} }
                Box::new(std::iter::once(row))
            }
            "packet"|"frame"|"packet_frame" if enabled=>{
                let combined=section=="packet_frame";
                Box::new((0..packets*if combined{2}else{1}).map(move|i|{
                    let frame=section=="frame"||combined&&i%2==1;let i=if combined{i/2}else{i};let offset=i*packet_size;
                    let size=packet_size.min(self.data.len()-offset);let samples=size as u64*8/(u64::from(self.channels)*u64::from(bits));
                    let pts=offset as u64*8/(u64::from(self.channels)*u64::from(bits));let time=format!("{:.6}",pts as f64/f64::from(self.rate));let duration=format!("{:.6}",samples as f64/f64::from(self.rate));
                    let mut row=if frame {vec![
                        ("media_type",Str("audio".into())),("stream_index",Number(0.,None)),("key_frame",Number(1.,None)),("pts",Number(pts as f64,None)),("pts_time",Str(time.clone())),("pkt_dts",Number(pts as f64,None)),("pkt_dts_time",Str(time.clone())),("best_effort_timestamp",Number(pts as f64,None)),("best_effort_timestamp_time",Str(time)),
                        ("pkt_duration",Number(samples as f64,None)),("pkt_duration_time",Str(duration.clone())),("duration",Number(samples as f64,None)),("duration_time",Str(duration)),("pkt_size",Str(size.to_string())),("pkt_pos",Str((self.offset+offset).to_string())),("sample_fmt",Str(sample_fmt.into())),("nb_samples",Number(samples as f64,None)),("channels",Number(f64::from(self.channels),None)),
                    ]}else{vec![("codec_type",Str("audio".into())),("stream_index",Number(0.,None)),("pts",Number(pts as f64,None)),("pts_time",Str(time.clone())),("dts",Number(pts as f64,None)),("dts_time",Str(time)),("duration",Number(samples as f64,None)),("duration_time",Str(duration)),("size",Str(size.to_string())),("pos",Str((self.offset+offset).to_string())),("flags",Str("K__".into()))]};
                    if combined {row.insert(0,("type",Str(if frame{"frame"}else{"packet"}.into())));} row
                }))
            }
            _=>Box::new(std::iter::empty()),
        })
    }
}

pub(super) fn write(code: u32, rate: u32, channels: usize, data: &[u8], opts: &Remux) -> Result<Vec<u8>,String> {
    let mut annotation=String::new();
    for key in ["title","artist","album"] {
        if let Some((_,value))=opts.metadata.iter().rev().find(|(k,_)|k.eq_ignore_ascii_case(key)).filter(|(_,v)|!v.is_empty()) {
            if !annotation.is_empty(){annotation.push('\n');}
            annotation.push_str(&key[..1].to_ascii_uppercase());annotation.push_str(&key[1..]);annotation.push('=');annotation.push_str(value);
            if annotation.len()>opts.limit{return Err("audio output exceeds memory budget".into());}
        }
    }
    let offset=24+annotation.len().saturating_add(1).next_multiple_of(8).max(8);
    if offset.saturating_add(data.len())>opts.limit || data.len()>u32::MAX as usize || offset>u32::MAX as usize {return Err("audio output exceeds memory budget".into());}
    let mut out=Vec::with_capacity(offset+data.len());
    for word in [0x2e736e64,offset as u32,if opts.stdout {u32::MAX}else{data.len() as u32},code,rate,channels as u32]{out.extend_from_slice(&word.to_be_bytes());}
    out.extend_from_slice(annotation.as_bytes());out.resize(offset,0);out.extend_from_slice(data);Ok(out)
}
