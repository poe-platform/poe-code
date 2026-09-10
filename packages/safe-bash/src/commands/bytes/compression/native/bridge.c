
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#if defined(BZ)
#include "bzlib.h"
#elif defined(XZ)
#include "lzma.h"
#else
#define ZSTD_STATIC_LINKING_ONLY
#include "zstd.h"
#endif
#define API __attribute__((visibility("default")))
#define CHUNK 65536
static size_t used, peak, limit;
static uint32_t taken, made;
static int active, decompressing;
typedef union { max_align_t alignment; size_t size; } allocation_header;
static void *allocate(void *opaque, size_t n) {
 (void)opaque;
 if (n > SIZE_MAX - sizeof(allocation_header)) return NULL;
 size_t total=n+sizeof(allocation_header);
 if(total>limit-used)return NULL;
 allocation_header *p=malloc(total);if(!p)return NULL;
 p->size=total;used+=total;if(used>peak)peak=used;return p+1;
}
static void release(void *opaque, void *p) { (void)opaque; if(p) {allocation_header *h=(allocation_header*)p-1;used-=h->size;free(h);} }
#if defined(BZ)
static bz_stream s;
static uint32_t buffered,flush_remaining;static int flushing;
static void *bzalloc(void *p,int n,int size){if(n<0||size<0||(size&&((size_t)n)>SIZE_MAX/(size_t)size))return NULL;return allocate(p,(size_t)n*size);}
#elif defined(XZ)
static lzma_stream s;
static void *xzalloc(void*p,size_t n,size_t size){if(size&&n>SIZE_MAX/size)return NULL;return allocate(p,n*size);}
static const lzma_allocator allocator={xzalloc,release,NULL};
#else
static ZSTD_CCtx *enc; static ZSTD_DCtx *dec;
#endif
API void bridge_destroy(void) {
 if(!active)return;
#if defined(BZ)
 if(decompressing)BZ2_bzDecompressEnd(&s);else BZ2_bzCompressEnd(&s);
#elif defined(XZ)
 lzma_end(&s);
#else
 ZSTD_freeCCtx(enc);ZSTD_freeDCtx(dec);enc=NULL;dec=NULL;
#endif
 active=0;
}
API int bridge_create(int decode,int level,uint32_t memory_limit,uint32_t window_log) {
 if(active||memory_limit<1024||memory_limit>64*1024*1024||level<1||level>9||window_log<10||window_log>26)return -1;
 limit=memory_limit;peak=used=0;taken=made=0;decompressing=!!decode;active=1;int ok=0;
#if defined(BZ)
 buffered=flush_remaining=0;flushing=0;memset(&s,0,sizeof(s));s.bzalloc=bzalloc;s.bzfree=release;
 ok=(decode?BZ2_bzDecompressInit(&s,0,0):BZ2_bzCompressInit(&s,level,0,30))==BZ_OK;
#elif defined(XZ)
 s=(lzma_stream)LZMA_STREAM_INIT;s.allocator=&allocator;
 ok=(decode?lzma_stream_decoder(&s,memory_limit,0):lzma_easy_encoder(&s,level,LZMA_CHECK_CRC64))==LZMA_OK;
#else
 ZSTD_customMem mem={allocate,release,NULL};
 if(decode){dec=ZSTD_createDCtx_advanced(mem);ok=dec&&!ZSTD_isError(ZSTD_DCtx_setParameter(dec,ZSTD_d_windowLogMax,window_log));}
 else{enc=ZSTD_createCCtx_advanced(mem);ok=enc&&!ZSTD_isError(ZSTD_CCtx_setParameter(enc,ZSTD_c_compressionLevel,level));}
#endif
 if(!ok){bridge_destroy();return -2;}return 0;
}
API int bridge_step(uint8_t*in,uint32_t inlen,uint8_t*out,uint32_t outlen,int finish){
 taken=made=0;if(!active||inlen>CHUNK||outlen>CHUNK||!outlen)return -1;
#if defined(BZ)
 uint32_t offered=inlen;
 int action=finish?BZ_FINISH:BZ_RUN;
 if(!decompressing){
  if(flushing){offered=flush_remaining;if(offered>inlen)return -1;action=BZ_FLUSH;}
  else {
   if(offered>CHUNK-buffered)offered=CHUNK-buffered;
   if(buffered+offered>=CHUNK && (!finish||offered<inlen)){flushing=1;action=BZ_FLUSH;}
  }
 }
 s.next_in=(char*)in;s.avail_in=offered;s.next_out=(char*)out;s.avail_out=outlen;
 int r=decompressing?BZ2_bzDecompress(&s):BZ2_bzCompress(&s,action);
 taken=offered-s.avail_in;made=outlen-s.avail_out;
 if(!decompressing){buffered+=taken;if(action==BZ_FLUSH){flush_remaining=s.avail_in;if(r==BZ_RUN_OK){buffered=0;flushing=0;}}}
 if(r==BZ_STREAM_END)return 1;if(r!=BZ_OK&&r!=BZ_RUN_OK&&r!=BZ_FINISH_OK&&r!=BZ_FLUSH_OK)return -3;
#elif defined(XZ)
 s.next_in=in;s.avail_in=inlen;s.next_out=out;s.avail_out=outlen;
 int r=lzma_code(&s,finish?LZMA_FINISH:LZMA_RUN);taken=inlen-s.avail_in;made=outlen-s.avail_out;
 if(r==LZMA_STREAM_END)return 1;if(r!=LZMA_OK)return -3;
#else
 ZSTD_inBuffer ib={in,inlen,0};ZSTD_outBuffer ob={out,outlen,0};
 size_t r=decompressing?ZSTD_decompressStream(dec,&ob,&ib):ZSTD_compressStream2(enc,&ob,&ib,finish?ZSTD_e_end:ZSTD_e_continue);
 taken=ib.pos;made=ob.pos;if(ZSTD_isError(r))return -3;if(r==0&&(decompressing||finish))return 1;
#endif
 if(!taken&&!made&&finish)return -4;return made==outlen?3:2;
}
API uint32_t bridge_consumed(void){return taken;}
API uint32_t bridge_produced(void){return made;}
API uint32_t bridge_used(void){return used;}
API uint32_t bridge_peak(void){return peak;}
static uint8_t input[CHUNK],output[CHUNK];
API void *bridge_input(void){return input;}
API void *bridge_output(void){return output;}
