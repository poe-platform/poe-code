import { replaceOnce } from './prototype.mjs';

export const probe = `#include "config.h"
#include <regex.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <locale.h>
int main(int count, char **arguments) {
  if (count != 3 || strlen(arguments[1]) > 64 || strlen(arguments[2]) > 128) return 99;
  if (!setlocale(LC_ALL, "C")) return 97;
  struct re_pattern_buffer pattern = {0};
  struct re_registers registers = {0};
  re_set_syntax(RE_SYNTAX_POSIX_BASIC & ~RE_CONTEXT_INVALID_DUP & ~RE_NO_EMPTY_RANGES);
  const char *error = re_compile_pattern(arguments[2], strlen(arguments[2]), &pattern);
  if (error) { fprintf(stderr, "%s\\n", error); return 98; }
  pattern.newline_anchor = 0;
  regoff_t length = re_match(&pattern, arguments[1], strlen(arguments[1]), 0, &registers);
  printf("{\\"length\\":%ld,\\"registers\\":[", (long)length);
  for (size_t index = 0; index < registers.num_regs; index++) printf("%s[%ld,%ld]", index ? "," : "", (long)registers.start[index], (long)registers.end[index]);
  printf("]}\\n");
  free(registers.start); free(registers.end); regfree(&pattern);
  return 0;
}
`;

export function traceNative(source) {
  source = replaceOnce(source, '      re_node_set *edests = &dfa->edests[node];', `      re_node_set *edests = &dfa->edests[node];
      fprintf(stderr, "edges node=%ld:", (long)node);
      for (Idx edge = 0; edge < edests->nelem; edge++) fprintf(stderr, " %ld/%d", (long)edests->elems[edge], !!re_node_set_contains(cur_nodes, edests->elems[edge]));
      fprintf(stderr, " state:");
      for (Idx member = 0; member < cur_nodes->nelem; member++) fprintf(stderr, " %ld", (long)cur_nodes->elems[member]);
      fprintf(stderr, "\\n");`);
  source = replaceOnce(source, '      update_regs (dfa, pmatch, prev_idx_match, cur_node, idx, nmatch);', `      fprintf(stderr, "before node=%ld type=%d offset=%ld cap=[%ld,%ld] prev=[%ld,%ld] fs=%ld cycle=%d last=%ld end=%ld\\n", (long)cur_node, dfa->nodes[cur_node].type, (long)idx, (long)pmatch[1].rm_so, (long)pmatch[1].rm_eo, (long)prev_idx_match[1].rm_so, (long)prev_idx_match[1].rm_eo, fs ? (long)fs->num : -1L, !!re_node_set_contains(&eps_via_nodes,cur_node), (long)mctx->last_node, (long)pmatch[0].rm_eo);
      update_regs (dfa, pmatch, prev_idx_match, cur_node, idx, nmatch);
      fprintf(stderr, "after cap=[%ld,%ld] prev=[%ld,%ld]\\n", (long)pmatch[1].rm_so, (long)pmatch[1].rm_eo, (long)prev_idx_match[1].rm_so, (long)prev_idx_match[1].rm_eo);`);
  source = replaceOnce(source, '      /* Proceed to next node.  */', '      fprintf(stderr, "proceed node=%ld offset=%ld\\n", (long)cur_node, (long)idx);\n      /* Proceed to next node.  */');
  source = replaceOnce(source, '  if (fs == NULL || fs->num == 0)', '  fprintf(stderr, "pop available=%ld\\n", fs ? (long)fs->num : -1L);\n  if (fs == NULL || fs->num == 0)');
  source = replaceOnce(source, '  Idx num = fs->num;', '  fprintf(stderr, "push node=%ld offset=%ld cap=[%ld,%ld] prev=[%ld,%ld]\\n", (long)dest_node, (long)str_idx, (long)regs[1].rm_so, (long)regs[1].rm_eo, (long)prevregs[1].rm_so, (long)prevregs[1].rm_eo);\n  Idx num = fs->num;');
  return source;
}
