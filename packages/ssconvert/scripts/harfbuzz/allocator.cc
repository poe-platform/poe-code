#include "hb.h"
#include <cstdlib>
#include <limits>
extern "C" void* hb_malloc_impl(size_t);
extern "C" void* hb_calloc_impl(size_t,size_t);
extern "C" void* hb_realloc_impl(void*,size_t);
extern "C" void hb_free_impl(void*);
extern "C" void ssconvert_hb_resource_failure(unsigned);
extern "C" unsigned ssconvert_hb_failure(hb_buffer_t*);
static bool allocation_failed=false;
static unsigned resource_failed=0;
extern "C" void* hb_malloc_impl(size_t size){void*p=std::malloc(size);if(!p&&size)allocation_failed=true;return p;}
extern "C" void* hb_calloc_impl(size_t n,size_t size){if(size&&n>std::numeric_limits<size_t>::max()/size){allocation_failed=true;return nullptr;}void*p=std::calloc(n,size);if(!p&&n&&size)allocation_failed=true;return p;}
extern "C" void* hb_realloc_impl(void*p,size_t size){void*q=std::realloc(p,size);if(!q&&size)allocation_failed=true;return q;}
extern "C" void hb_free_impl(void*p){std::free(p);}
extern "C" void ssconvert_hb_resource_failure(unsigned kind){resource_failed|=1u<<kind;}
// Bits: 1 allocator; 2 shaping buffer; 4 sanitizer work; 8 subtables; 16 recursion.
extern "C" unsigned ssconvert_hb_failure(hb_buffer_t*buffer){return (allocation_failed?1u:0u)|(buffer&&!hb_buffer_allocation_successful(buffer)?2u:0u)|(resource_failed<<1);}
