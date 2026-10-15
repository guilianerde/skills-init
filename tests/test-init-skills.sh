#!/usr/bin/env bash
# =====================================================================
# init-skills.sh 黑盒测试：每个用例在临时目录放一份 skills-init 副本，执行安装后断言结果。
# 兼容 macOS 自带 bash 3.2；安装脚本用跑测试的同一个 bash 执行（$BASH）。
#
# 用法：
#   bash tests/test-init-skills.sh            # 跑全部用例
#   bash tests/test-init-skills.sh upgrade    # 只跑名字含 upgrade 的用例
# 依赖：python3（校验 JSON）；升级用例需要 git 历史中的 71a23c8（CI 用 fetch-depth: 0）。
# =====================================================================

set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS=(workflow dev code-review database-query md-to-wiki create-tech-md-doc create-release-md-doc)
OLD_REV=71a23c8   # 单一来源之前的版本：各环境独立拷贝，画像在 dev/profile.json
FILTER="${1:-}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/skills-init-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASSED=0 FAILED=0 CASE_FAILED=0
FAILED_CASES=()

fail() { printf '    FAIL  %s\n' "$*"; CASE_FAILED=1; }

assert_file()     { [[ -f "$P/$1" && ! -L "$P/$1" ]] || fail "应为普通文件: $1"; }
assert_dir()      { [[ -d "$P/$1" && ! -L "$P/$1" ]] || fail "应为真实目录: $1"; }
assert_missing()  { [[ ! -e "$P/$1" && ! -L "$P/$1" ]] || fail "不应存在: $1"; }
assert_link()     { # $1=路径  $2=期望的链接目标
  if [[ ! -L "$P/$1" ]]; then fail "应为软链接: $1"; return; fi
  [[ "$(readlink "$P/$1")" == "$2" ]] || fail "$1 -> $(readlink "$P/$1")，期望 -> $2"
  [[ -d "$P/$1" ]] || fail "软链接目标不存在: $1"
}
assert_same()     { cmp -s "$P/$1" "$2" || fail "$1 内容与 $2 不同"; }
assert_content()  { [[ "$(cat "$P/$1")" == "$2" ]] || fail "$1 内容不符：$(cat "$P/$1" 2>/dev/null | head -n 3)"; }
assert_contains() { grep -qF -- "$2" "$P/$1" || fail "$1 中缺少: $2"; }
assert_eq()       { [[ "$1" == "$2" ]] || fail "$3：实际 [$1]，期望 [$2]"; }

# 新建项目：<P>/skills-init 是当前工作区的副本
new_project() {
  P="$WORK/$1"; LOG="$WORK/$1.log"
  mkdir -p "$P/skills-init"
  # 整个工作区（除 git / CI / 测试本身），实现换成什么都按原样带上
  local e
  for e in "$REPO"/* "$REPO"/.[!.]*; do
    case "${e##*/}" in .git|.github|.claude|tests|'.[!.]*') continue ;; esac
    cp -R "$e" "$P/skills-init/"
  done
}

# 运行安装脚本：stdin 由调用方提供（默认空），输出写入 $LOG，返回退出码到 RC
run_install() {
  (cd "$P" && "$BASH" skills-init/init-skills.sh "$@") >>"$LOG" 2>&1
  RC=$?
}
expect_rc() { [[ "$RC" == "$1" ]] || { fail "退出码 $RC，期望 $1（日志 ${LOG#$WORK/}）"; sed 's/^/        | /' "$LOG" | tail -n 20; }; }

# 用 git 历史中的旧版脚本生成旧布局（各环境独立拷贝），再换成当前版本的 skills-init
old_layout() {
  rm -rf "$P/skills-init"; mkdir -p "$P/skills-init"
  if ! git -C "$REPO" archive "$OLD_REV" | tar -x -C "$P/skills-init"; then
    fail "无法从 git 历史取出 $OLD_REV（CI 需 fetch-depth: 0）"; return 1
  fi
  (cd "$P" && "$BASH" skills-init/init-skills.sh "$@" </dev/null) >>"$LOG" 2>&1 || { fail "旧版脚本执行失败"; return 1; }
  rm -rf "$P/skills-init"
  new_project "${P##*/}"
}

json_get() { # $1=文件  $2=python 下标表达式；JSON 解析失败时输出 <invalid>
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval("d"+sys.argv[2]), end="")' "$P/$1" "$2" 2>/dev/null || printf '<invalid>'
}

all_linked() { # $1=环境目录（如 .claude/skills）
  local s; for s in "${SKILLS[@]}"; do assert_link "$1/$s" "../../.agents/skills/$s"; done
}

fill_profile() { printf '{\n  "main_branch": "%s",\n  "build": "make"\n}\n' "$2" > "$P/$1"; }
fill_wiki()    { printf '{\n  "enabled": true,\n  "wiki": { "base_url": "%s" }\n}\n' "$2" > "$P/$1"; }

# 交互输入：驱动 / 主机 / 端口 / 库名 / 用户 / 密码
PASSWORD='p/a&s|s"w\o\"rd\'
db_answers() { printf 'mysql\n127.0.0.1\n3307\nappdb\nroot\n%s\n' "$PASSWORD" > "$WORK/answers"; echo "$WORK/answers"; }

# =====================================================================
test_fresh_install_links() {
  new_project fresh
  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  local s
  for s in "${SKILLS[@]}"; do
    assert_dir ".agents/skills/$s"
    assert_file ".agents/skills/$s/SKILL.md"
  done
  all_linked .claude/skills
  all_linked .qwen/skills
  assert_same .agents/skills/code-review/references/checklist.md "$REPO/code-review/references/checklist.md.tpl"
  assert_same .agents/skills/md-to-wiki/scripts/md_to_wiki.py "$REPO/md-to-wiki/scripts/md_to_wiki.py"
  assert_same .agents/skills/md-to-wiki/wiki-config.json "$REPO/md-to-wiki/wiki-config.json.tpl"
  assert_same .agents/skills/workflow/profile.json "$REPO/workflow/profile.json.tpl"
  assert_missing .agents/skills/database-query/config.json
  # 链接可以直接读到单一来源的内容
  assert_same .claude/skills/workflow/SKILL.md "$REPO/workflow/SKILL.md.tpl"
  # 重跑：链接已正确时保持不变
  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  all_linked .claude/skills
  assert_missing tmp/skills/backup
}

test_copy_mode() {
  new_project copy
  run_install --envs claude,qwen --copy --yes --skip-db </dev/null; expect_rc 0
  local d s
  for d in .claude/skills .qwen/skills; do
    for s in "${SKILLS[@]}"; do assert_dir "$d/$s"; assert_file "$d/$s/SKILL.md"; done
    assert_same "$d/workflow/profile.json" "$REPO/workflow/profile.json.tpl"
  done
  # 没选 codex / doubao 时 --copy 不装 .agents/skills
  assert_missing .agents/skills
}

test_yes_without_db_config_fails() {
  new_project yes-no-db
  run_install --envs claude --yes </dev/null; expect_rc 1
  assert_missing .agents/skills
}

test_interactive_password_escaping() {
  new_project password
  run_install --envs claude,qwen <"$(db_answers)"; expect_rc 0
  local cfg=.agents/skills/database-query/config.json
  assert_file "$cfg"
  assert_eq "$(json_get "$cfg" '["connections"]["default"]["password"]')" "$PASSWORD" "config.json 中的密码"
  assert_eq "$(json_get "$cfg" '["connections"]["default"]["port"]')" "3307" "config.json 中的端口"
  assert_eq "$(json_get "$cfg" '["connections"]["default"]["user"]')" "root" "config.json 中的用户"
  assert_file .agents/skills/database-query/references/schema.md
  assert_contains .agents/skills/database-query/references/schema.md appdb
  # --yes 重跑复用已有配置：密码经提取 / 反转义 / 再转义后保持一致
  run_install --envs claude,qwen --yes </dev/null; expect_rc 0
  assert_eq "$(json_get "$cfg" '["connections"]["default"]["password"]')" "$PASSWORD" "重跑后 config.json 中的密码"
}

test_rerun_preserves_user_files() {
  new_project rerun
  run_install --envs claude,qwen <"$(db_answers)"; expect_rc 0
  local c=.agents/skills
  fill_wiki "$c/md-to-wiki/wiki-config.json" https://wiki.example.com
  printf '# my schema\n' > "$P/$c/database-query/references/schema.md"
  fill_profile "$c/workflow/profile.json" develop
  printf 'stale\n' > "$P/$c/dev/SKILL.md"   # 模板文件会被更新
  cp "$P/$c/database-query/config.json" "$WORK/rerun-config.json"
  cp "$P/$c/md-to-wiki/wiki-config.json" "$WORK/rerun-wiki.json"
  cp "$P/$c/workflow/profile.json" "$WORK/rerun-profile.json"
  run_install --envs claude,qwen --yes </dev/null; expect_rc 0
  assert_same "$c/md-to-wiki/wiki-config.json" "$WORK/rerun-wiki.json"
  assert_content "$c/database-query/references/schema.md" '# my schema'
  assert_same "$c/workflow/profile.json" "$WORK/rerun-profile.json"
  assert_same "$c/database-query/config.json" "$WORK/rerun-config.json"
  assert_same "$c/dev/SKILL.md" "$REPO/dev/SKILL.md.tpl"
  # --skip-db 时保留已有 config.json
  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  assert_same "$c/database-query/config.json" "$WORK/rerun-config.json"
}

test_upgrade_from_copies() {
  new_project upgrade
  old_layout --envs all --yes --skip-db || return
  # 旧布局：各环境独立拷贝，没有 workflow，画像在 dev/profile.json
  assert_dir .claude/skills/dev; assert_file .claude/skills/dev/profile.json; assert_missing .claude/skills/workflow
  # 用户只在 claude / qwen 的拷贝里填写过配置，.agents 里仍是空模板
  fill_wiki .claude/skills/md-to-wiki/wiki-config.json https://wiki.example.com
  fill_profile .claude/skills/dev/profile.json main
  mkdir -p "$P/.qwen/skills/database-query/references"
  printf '{"connections":{"default":{"host":"db.local","database":"x"}}}\n' > "$P/.qwen/skills/database-query/config.json"
  printf '# qwen schema\n' > "$P/.qwen/skills/database-query/references/schema.md"
  cp "$P/.claude/skills/md-to-wiki/wiki-config.json" "$WORK/upgrade-wiki.json"
  cp "$P/.claude/skills/dev/profile.json" "$WORK/upgrade-profile.json"
  cp "$P/.qwen/skills/database-query/config.json" "$WORK/upgrade-config.json"

  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  all_linked .claude/skills
  all_linked .qwen/skills
  local c=.agents/skills
  assert_same "$c/md-to-wiki/wiki-config.json" "$WORK/upgrade-wiki.json"
  assert_same "$c/workflow/profile.json" "$WORK/upgrade-profile.json"
  assert_missing "$c/dev/profile.json"
  assert_same "$c/database-query/config.json" "$WORK/upgrade-config.json"
  assert_content "$c/database-query/references/schema.md" '# qwen schema'
  # 旧目录整体备份到 tmp/skills/backup/<时间戳>/<环境>/<skill>
  local b
  b="$(cd "$P" && ls -d tmp/skills/backup/*/claude/md-to-wiki 2>/dev/null | head -n 1)"
  if [[ -z "$b" ]]; then fail "缺少 claude 的 md-to-wiki 备份"; else assert_same "$b/wiki-config.json" "$WORK/upgrade-wiki.json"; fi
  local s e n
  for e in claude qwen; do
    for s in dev code-review database-query md-to-wiki create-tech-md-doc create-release-md-doc; do
      n="$(cd "$P" && ls -d tmp/skills/backup/*/$e/$s 2>/dev/null | wc -l | tr -d ' ')"
      assert_eq "$n" 1 "$e/$s 的备份数量"
    done
  done
}

test_upgrade_conflict_keeps_old_dir() {
  new_project conflict
  old_layout --envs all --yes --skip-db || return
  fill_wiki .agents/skills/md-to-wiki/wiki-config.json https://a.example.com
  fill_wiki .claude/skills/md-to-wiki/wiki-config.json https://b.example.com
  cp "$P/.agents/skills/md-to-wiki/wiki-config.json" "$WORK/conflict-a.json"
  cp "$P/.claude/skills/md-to-wiki/wiki-config.json" "$WORK/conflict-b.json"

  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  # 冲突的 skill 保留旧目录、不建链接；两边内容都不动
  assert_dir .claude/skills/md-to-wiki
  assert_same .claude/skills/md-to-wiki/wiki-config.json "$WORK/conflict-b.json"
  assert_same .agents/skills/md-to-wiki/wiki-config.json "$WORK/conflict-a.json"
  [[ -z "$(cd "$P" && ls -d tmp/skills/backup/*/claude/md-to-wiki 2>/dev/null)" ]] || fail "冲突的旧目录不应被备份移走"
  # 其余 skill 照常建链接；qwen 的拷贝没填写过 wiki，不算冲突
  local s
  for s in workflow dev code-review database-query create-tech-md-doc create-release-md-doc; do
    assert_link ".claude/skills/$s" "../../.agents/skills/$s"
  done
  all_linked .qwen/skills
}

test_gitignore_appends_only_missing() {
  new_project gitignore
  printf 'node_modules/\n**/wiki-config.json\n.env' > "$P/.gitignore"   # 末尾没有换行
  run_install --envs claude --yes --skip-db </dev/null; expect_rc 0
  local r
  for r in '**/database-query/config.json' '**/wiki-config.json' '/tmp/' 'node_modules/' '.env'; do
    assert_eq "$(grep -cxF -- "$r" "$P/.gitignore")" 1 ".gitignore 中 $r 的行数"
  done
  cp "$P/.gitignore" "$WORK/gitignore.after"
  run_install --envs claude --yes --skip-db </dev/null; expect_rc 0
  assert_same .gitignore "$WORK/gitignore.after"
}

# =====================================================================
command -v python3 >/dev/null 2>&1 || { echo "需要 python3 来校验 JSON" >&2; exit 2; }
echo "bash: $BASH ($BASH_VERSION)"

TESTS=(
  test_fresh_install_links
  test_copy_mode
  test_yes_without_db_config_fails
  test_interactive_password_escaping
  test_rerun_preserves_user_files
  test_upgrade_from_copies
  test_upgrade_conflict_keeps_old_dir
  test_gitignore_appends_only_missing
)
for t in "${TESTS[@]}"; do
  [[ -n "$FILTER" && "$t" != *"$FILTER"* ]] && continue
  CASE_FAILED=0
  echo "--- $t"
  "$t"
  if [[ "$CASE_FAILED" == "0" ]]; then
    PASSED=$((PASSED + 1)); echo "    PASS"
  else
    FAILED=$((FAILED + 1)); FAILED_CASES+=("$t")
  fi
done

echo
echo "通过 $PASSED，失败 $FAILED"
if [[ "$FAILED" != "0" ]]; then printf '  失败用例: %s\n' "${FAILED_CASES[@]}"; exit 1; fi
exit 0
