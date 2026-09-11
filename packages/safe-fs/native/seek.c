#include <node_api.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error Native seek currently supports Linux x64 only
#endif

typedef struct {
  int descriptor;
  int captured_errno;
  int64_t position;
  napi_async_work work;
  napi_deferred deferred;
} SeekRequest;

_Static_assert(NAPI_VERSION == 6, "Node-API 6 required");
_Static_assert(sizeof(off_t) == sizeof(int64_t), "64-bit off_t required");
_Static_assert(sizeof(SeekRequest) == 32, "fixed 32-byte request required");

static bool checked(napi_env env, napi_status status) {
  if (status == napi_ok) return true;
  if (status != napi_pending_exception) napi_throw_error(env, NULL, "Node-API call failed");
  return false;
}

#define CHECK(call) do { if (!checked(env, (call))) return NULL; } while (0)

static void reject_failure(napi_env env, napi_deferred deferred, const char* message,
                           napi_status primary, napi_status cleanup) {
  bool pending = false;
  napi_value error;
  napi_value text;
  napi_value status_value;
  napi_status status = napi_is_exception_pending(env, &pending);
  if (status == napi_ok && pending) status = napi_get_and_clear_last_exception(env, &error);
  else if (status == napi_ok) {
    status = napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
    if (status == napi_ok) status = napi_create_error(env, NULL, text, &error);
    if (status == napi_ok) status = napi_create_int32(env, (int32_t)primary, &status_value);
    if (status == napi_ok) status = napi_set_named_property(env, error, "napiStatus", status_value);
    if (status == napi_ok) status = napi_create_int32(env, (int32_t)cleanup, &status_value);
    if (status == napi_ok) status = napi_set_named_property(env, error, "cleanupStatus", status_value);
  }
  if (status == napi_ok) status = napi_reject_deferred(env, deferred, error);
  if (status != napi_ok && status != napi_pending_exception) napi_throw_error(env, NULL, "Unable to reject native seek Promise");
}

static void execute_seek(napi_env env, void* data) {
  (void)env;
  SeekRequest* request = data;
  errno = 0;
  const off_t position = lseek(request->descriptor, 0, SEEK_END);
  const int captured_errno = position == (off_t)-1 ? errno : 0;
  request->position = (int64_t)position;
  request->captured_errno = captured_errno;
}

static void complete_seek(napi_env env, napi_status completion, void* data) {
  SeekRequest* request = data;
  const napi_deferred deferred = request->deferred;
  const int64_t position = request->position;
  const int captured_errno = request->captured_errno;
  const napi_status cleanup = napi_delete_async_work(env, request->work);
  free(request);
  if (completion != napi_ok || cleanup != napi_ok) {
    reject_failure(env, deferred, "Native seek completion failed", completion != napi_ok ? completion : cleanup, cleanup);
    return;
  }

  napi_value result;
  napi_value position_value;
  napi_value errno_value;
  napi_status status = napi_create_object(env, &result);
  if (status == napi_ok) status = napi_create_bigint_int64(env, position, &position_value);
  if (status == napi_ok) status = napi_create_int32(env, captured_errno, &errno_value);
  if (status == napi_ok) status = napi_set_named_property(env, result, "offset", position_value);
  if (status == napi_ok) status = napi_set_named_property(env, result, "errno", errno_value);
  if (status != napi_ok) {
    reject_failure(env, deferred, "Native seek result creation failed", status, napi_ok);
    return;
  }
  status = napi_resolve_deferred(env, deferred, result);
  if (status != napi_ok) reject_failure(env, deferred, "Native seek Promise resolution failed", status, napi_ok);
}

static napi_value seek_end(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  CHECK(napi_get_cb_info(env, info, &count, args, NULL, NULL));
  if (count != 1) {
    napi_throw_type_error(env, NULL, "expected one int32 file descriptor");
    return NULL;
  }
  napi_valuetype descriptor_type;
  CHECK(napi_typeof(env, args[0], &descriptor_type));
  if (descriptor_type != napi_number) {
    napi_throw_type_error(env, NULL, "file descriptor must be an int32 number");
    return NULL;
  }
  double descriptor_value;
  CHECK(napi_get_value_double(env, args[0], &descriptor_value));
  if (!(descriptor_value >= INT_MIN && descriptor_value <= INT_MAX) || descriptor_value != (int)descriptor_value) {
    napi_throw_type_error(env, NULL, "file descriptor must be an int32 number");
    return NULL;
  }

  napi_value resource_name;
  CHECK(napi_create_string_utf8(env, "safe-fs:seek-end", NAPI_AUTO_LENGTH, &resource_name));
  SeekRequest* request = calloc(1, sizeof(*request));
  if (!request) {
    napi_throw_error(env, NULL, "Unable to allocate native seek request");
    return NULL;
  }
  request->descriptor = (int)descriptor_value;
  napi_value promise;
  napi_status status = napi_create_promise(env, &request->deferred, &promise);
  if (status != napi_ok) {
    free(request);
    checked(env, status);
    return NULL;
  }
  const napi_deferred deferred = request->deferred;
  status = napi_create_async_work(env, NULL, resource_name, execute_seek, complete_seek, request, &request->work);
  if (status != napi_ok) {
    free(request);
    reject_failure(env, deferred, "Native seek work creation failed", status, napi_ok);
    return promise;
  }
  status = napi_queue_async_work(env, request->work);
  if (status != napi_ok) {
    const napi_status cleanup = napi_delete_async_work(env, request->work);
    free(request);
    reject_failure(env, deferred, "Native seek queue failed", status, cleanup);
  }
  return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value seek;
  CHECK(napi_create_function(env, "seekEnd", NAPI_AUTO_LENGTH, seek_end, NULL, &seek));
  CHECK(napi_set_named_property(env, exports, "seekEnd", seek));
  return exports;
}

NAPI_MODULE(safe_fs_seek, initialize)
