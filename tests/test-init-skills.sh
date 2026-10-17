#!/usr/bin/env bash
# =====================================================================
# init-skills.sh 冒烟测试：只验证封装脚本本身——以上级目录为项目根、参数与子命令原样透传、stdin 交互可用。
# 安装逻辑的完整场景在 tests/test-install.mjs（node --test，三个平台都跑）。
# 兼容 macOS 自带 bash 3.2；安装脚本用跑测试的同一个 bash 执行（$BASH）。
#
# 用法：
#   bash tests/test-init-skills.sh            # 跑全部用例
#   bash tests/test-init-skills.sh upgrade    # 只跑名字含 upgrade 的用例
# 依赖：python3（校验 JSON）。
# =====================================================================

set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS=(workflow dev project-review database-query md-to-wiki create-tech-md-doc create-release-md-doc)
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

# 当前工作区的副本放到 $1（实现换成什么都按原样带上；除 git / CI / 测试本身）
copy_installer() {
  mkdir -p "$1"
  local e
  for e in "$REPO"/* "$REPO"/.[!.]*; do
    case "${e##*/}" in .git|.github|.claude|tests|tmp|'.[!.]*') continue ;; esac
    cp -R "$e" "$1/"
  done
}
# 新建项目 <P>；安装器副本放在项目外 <INST>
new_project() {
  P="$WORK/$1"; LOG="$WORK/$1.log"; INST="$WORK/installer-$1"
  mkdir -p "$P"
  copy_installer "$INST"
}

# 在项目根运行安装脚本：stdin 由调用方提供（默认空），输出写入 $LOG，返回退出码到 RC
run_install() {
  (cd "$P" && "$BASH" "$INST/init-skills.sh" "$@") >>"$LOG" 2>&1
  RC=$?
}
expect_rc() { [[ "$RC" == "$1" ]] || { fail "退出码 ${RC}，期望 $1（日志 ${LOG#$WORK/}）"; sed 's/^/        | /' "$LOG" | tail -n 20; }; }

json_get() { # $1=文件  $2=python 下标表达式；JSON 解析失败时输出 <invalid>
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval("d"+sys.argv[2]), end="")' "$P/$1" "$2" 2>/dev/null || printf '<invalid>'
}

all_linked() { # $1=环境目录（如 .claude/skills）
  local s; for s in "${SKILLS[@]}"; do assert_link "$1/$s" "../../.agents/skills/$s"; done
}

# 交互输入：驱动 / 主机 / 端口 / 库名 / 用户 / 密码
PASSWORD='p/a&s|s"w\o\"rd\'
db_answers() { printf 'mysql\n127.0.0.1\n3307\nappdb\nroot\n%s\n' "$PASSWORD" > "$WORK/answers"; echo "$WORK/answers"; }

# =====================================================================
test_wrapper_installs_into_current_dir() {
  new_project fresh
  run_install --envs claude,qwen --yes --skip-db </dev/null; expect_rc 0
  local s
  for s in "${SKILLS[@]}"; do assert_file ".agents/skills/$s/SKILL.md"; done
  all_linked .claude/skills
  all_linked .qwen/skills
  [[ -e "$INST/.agents" ]] && fail "装到了安装器目录里"
  # 旧用法：安装器克隆在项目的 skills-init/（现在是放产出的目录）→ 停下并提示挪走，不做改动
  new_project old-layout
  copy_installer "$P/skills-init"
  (cd "$P" && "$BASH" skills-init/init-skills.sh --envs claude --yes --skip-db) </dev/null >>"$LOG" 2>&1; RC=$?
  expect_rc 1
  grep -qF '安装器移到项目外' "$LOG" || fail "缺少挪走安装器的提示"
  assert_missing .agents/skills
}

test_flags_pass_through() {
  new_project flags
  run_install --envs claude,qwen --copy --yes --skip-db </dev/null; expect_rc 0
  assert_dir .claude/skills/workflow
  assert_missing .agents/skills
  new_project flags-yes
  run_install --envs claude --yes </dev/null; expect_rc 1
  assert_missing .agents/skills
  : > "$LOG"
  run_install --version </dev/null; expect_rc 0
  grep -qxF "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$REPO/package.json")" "$LOG" || fail "--version 输出不符"
}

test_interactive_stdin() {
  new_project password
  run_install --envs claude <"$(db_answers)"; expect_rc 0
  assert_eq "$(json_get .agents/skills/database-query/config.json '["connections"]["default"]["password"]')" "$PASSWORD" "config.json 中的密码"
}

test_subcommands_pass_through() {
  new_project subcommands
  run_install --envs claude --yes --skip-db </dev/null; expect_rc 0
  : > "$LOG"
  run_install doctor --offline </dev/null; expect_rc 0
  grep -qF '0 个错误' "$LOG" || fail "doctor 输出缺少汇总"
  run_install upgrade </dev/null; expect_rc 0
  grep -qF '升级：' "$LOG" || fail "upgrade 输出缺少版本信息"
  run_install report --since 2026-01-01 --json </dev/null; expect_rc 0
  grep -qF '"since": "2026-01-01"' "$LOG" || fail "report 未按 --since / --json 输出"
  run_install uninstall </dev/null; expect_rc 0
  assert_missing .agents/skills/workflow
  assert_missing .claude/skills/workflow
}

# =====================================================================
command -v python3 >/dev/null 2>&1 || { echo "需要 python3 来校验 JSON" >&2; exit 2; }
echo "bash: $BASH ($BASH_VERSION)"

TESTS=(
  test_wrapper_installs_into_current_dir
  test_flags_pass_through
  test_interactive_stdin
  test_subcommands_pass_through
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
echo "通过 ${PASSED}，失败 $FAILED"
if [[ "$FAILED" != "0" ]]; then printf '  失败用例: %s\n' "${FAILED_CASES[@]}"; exit 1; fi
exit 0
