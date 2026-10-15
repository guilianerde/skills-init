#!/usr/bin/env bash
# =====================================================================
# init-skills.sh — 项目级 Agent Skills 一键初始化（dev / code-review / database-query / 文档类）
# 跨平台版：macOS / Linux / Windows(Git Bash / WSL)；兼容 macOS 自带 bash 3.2
#
# 支持环境：codex / claude / doubao / qwen
#   安装路径（均为项目级，团队共享）：
#     codex  -> .agents/skills    （Codex 项目级 skills，与豆包共用目录）
#     claude -> .claude/skills
#     doubao -> .agents/skills
#     qwen   -> .qwen/skills
#
# 用法（脚本固定位于 <项目根>/skills-init/ 下，模板随脚本同目录）：
#   ./skills-init/init-skills.sh                                   # 交互式：选择环境、配置数据库
#   ./skills-init/init-skills.sh --envs codex,claude,doubao,qwen   # 指定环境（仍会交互确认数据库）
#   ./skills-init/init-skills.sh --envs all --yes --skip-db        # 全环境、非交互、跳过数据库
#
# 重跑安全：SKILL.md / references 模板会更新；用户已填写的 wiki-config.json、
#           schema.md、dev/profile.json 保留不覆盖；database-query/config.json 仅在本次提供了数据库配置时写入。
# =====================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TPL_DIR="$SCRIPT_DIR"
ENVS_ARG=""
SKIP_DB=0
YES=0

# ---------------- 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    --envs)   ENVS_ARG="${2:-}"; shift 2 ;;
    --skip-db) SKIP_DB=1; shift ;;
    --yes)    YES=1; shift ;;
    -h|--help)
      echo "用法: ./init-skills.sh [--envs codex,claude,doubao,qwen|all] [--skip-db] [--yes]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

ENV_NAMES=(codex claude doubao qwen)

step() { printf '==> %s\n' "$1"; }
ok()   { printf '    OK  %s\n' "$1"; }
warn() { printf '    !!  %s\n' "$1" >&2; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }  # bash 3.2 无 ${x,,}

# ---------------- 1. 环境选择
resolve_env() {
  if [[ -n "$ENVS_ARG" ]]; then
    if [[ "$(lower "$ENVS_ARG")" == "all" ]]; then printf '%s\n' "${ENV_NAMES[@]}"; return; fi
    local sel=() p e
    IFS=',' read -ra parts <<< "$ENVS_ARG"
    for p in ${parts[@]+"${parts[@]}"}; do
      p="$(lower "$p")"; p="${p// /}"
      for e in "${ENV_NAMES[@]}"; do [[ "$p" == "$e" ]] && sel+=("$e"); done
    done
    if [[ ${#sel[@]} -eq 0 ]]; then printf '%s\n' "${ENV_NAMES[@]}"; else printf '%s\n' "${sel[@]}" | sort -u; fi
    return
  fi
  step "选择要安装 skills 的环境" >&2
  echo "  1) codex     -> .agents/skills （Codex 项目级，与豆包共用）" >&2
  echo "  2) claude    -> .claude/skills （Claude Code 项目级）" >&2
  echo "  3) doubao    -> .agents/skills （豆包办公项目级）" >&2
  echo "  4) qwen      -> .qwen/skills   （Qwen Code 项目级）" >&2
  printf '输入编号（逗号分隔，如 1,3；直接回车 = 全部）: ' >&2
  local choice
  read -r choice
  if [[ -z "${choice// }" ]]; then printf '%s\n' "${ENV_NAMES[@]}"; return; fi
  local sel=() p
  choice="${choice//，/,}"
  IFS=', ' read -ra parts <<< "$choice"
  for p in ${parts[@]+"${parts[@]}"}; do
    [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 4 )) && sel+=("${ENV_NAMES[p-1]}")
  done
  if [[ ${#sel[@]} -eq 0 ]]; then warn "未识别到有效编号，按全部安装"; printf '%s\n' "${ENV_NAMES[@]}"; else printf '%s\n' "${sel[@]}" | sort -u; fi
}

# ---------------- JSON 取值（无 jq/python 依赖，宽松提取）
json_val() { # $1=file  $2=key；返回 JSON 原文（未反转义，支持值内 \" 与 \\）
  sed -nE "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\".*/\\1/p" "$1" | head -n 1
}
json_unescape() { printf '%s' "$1" | sed -e 's/\\"/"/g' -e 's/\\\\/\\/g'; }

# ---------------- 转义：先按 JSON 字符串转义，再按 sed 替换串转义（分隔符 |）
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
sed_escape()  { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
render() { # $1=模板  $2=输出  其余为 key=value（值原样，内部做 JSON+sed 转义）
  local tpl="$1" out="$2" kv k v args=()
  shift 2
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    args+=(-e "s|{{$k}}|$(sed_escape "$(json_escape "$v")")|g")
  done
  sed "${args[@]}" "$tpl" > "$out"
}

# ---------------- 已有数据库配置来源（旧版 .codex 目录 + 已安装的各环境目录）
find_existing_db_config() {
  local f
  for f in ".codex/database-query/config.json" ".agents/skills/database-query/config.json" \
           ".claude/skills/database-query/config.json" ".qwen/skills/database-query/config.json"; do
    if [[ -f "$ROOT_DIR/$f" && -n "$(json_val "$ROOT_DIR/$f" host)" ]]; then echo "$ROOT_DIR/$f"; return; fi
  done
}

# ---------------- 2. 数据库连接配置（结果写入全局 DB_*，返回 1 表示跳过）
DB_DRIVER="" DB_HOST="" DB_PORT="" DB_NAME="" DB_USER="" DB_PASS=""
get_db() {
  local legacy a
  legacy="$(find_existing_db_config)"
  if [[ -n "$legacy" ]]; then
    local d host db user pw port
    d=$(json_val "$legacy" driver); [[ -z "$d" ]] && d=mysql
    host=$(json_val "$legacy" host); db=$(json_val "$legacy" database)
    if [[ -n "$host" && -n "$db" ]]; then
      user=$(json_val "$legacy" user)
      pw=$(json_val "$legacy" password)
      port=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$legacy" | head -n 1)
      step "数据库连接配置"
      echo "    检测到现有配置: $legacy"
      echo "    driver=$d  host=$host:${port:-?}  db=$db  user=$user  password=${pw:+****}"
      local use=1
      if [[ "$YES" == "1" ]]; then
        ok "非交互模式，使用现有配置"
      else
        printf '使用此配置？[Y=使用 / n=重新填写 / s=跳过数据库]: '
        read -r a
        case "$(lower "$a")" in
          s|skip) return 1 ;;
          n) use=0 ;;
        esac
      fi
      if [[ "$use" == "1" ]]; then
        # json_val 读到的是 JSON 已转义的原文，这里还原，render 时会再统一转义
        pw="$(json_unescape "$pw")"
        DB_DRIVER="$d" DB_HOST="$host" DB_PORT="${port:-3306}" DB_NAME="$db" DB_USER="$user" DB_PASS="$pw"
        return 0
      fi
    fi
  fi
  [[ "$YES" == "1" ]] && return 1
  local driver host port database user password
  step "填写数据库连接（将写入各环境 database-query/config.json，并加入 .gitignore）"
  printf '数据库驱动 [mysql]: '; read -r driver
  printf '数据库主机: '; read -r host
  printf '端口: '; read -r port
  printf '数据库名: '; read -r database
  printf '用户名: '; read -r user
  printf '密码: '; read -r -s password; echo
  [[ -z "${driver}" ]] && driver=mysql
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then [[ "$driver" == "postgresql" ]] && port=5432 || port=3306; fi
  if [[ -z "${host}" || -z "${database}" || -z "${user}" ]]; then
    warn "主机/库名/用户不能为空，跳过数据库配置"; return 1
  fi
  DB_DRIVER="$driver" DB_HOST="$host" DB_PORT="$port" DB_NAME="$database" DB_USER="$user" DB_PASS="$password"
}

# ---------------- 3. 安装
install_skills() { # $1=目标目录  $2=是否有数据库配置(1/0)
  local base="$1" has_db="$2"
  mkdir -p "$base/code-review/references" "$base/database-query/references" \
           "$base/md-to-wiki/scripts" "$base/create-tech-md-doc" "$base/create-release-md-doc" \
           "$base/dev/references"
  # code-review
  cp "$TPL_DIR/code-review/SKILL.md.tpl"                "$base/code-review/SKILL.md"
  cp "$TPL_DIR/code-review/references/checklist.md.tpl" "$base/code-review/references/checklist.md"
  ok "code-review -> $base/code-review"
  # database-query
  cp "$TPL_DIR/database-query/SKILL.md.tpl"             "$base/database-query/SKILL.md"
  ok "database-query(SKILL.md) -> $base/database-query"
  if [[ "$has_db" == "1" ]]; then
    render "$TPL_DIR/database-query/config.json.tpl" "$base/database-query/config.json" \
      "driver=$DB_DRIVER" "host=$DB_HOST" "port=$DB_PORT" "database=$DB_NAME" "user=$DB_USER" "password=$DB_PASS"
    ok "database-query/config.json -> $base/database-query/config.json"
    if [[ -f "$base/database-query/references/schema.md" ]]; then
      ok "database-query/references/schema.md 已存在，保留不覆盖"
    else
      render "$TPL_DIR/database-query/references/schema.md.tpl" "$base/database-query/references/schema.md" \
        "database=$DB_NAME" "host=$DB_HOST" "port=$DB_PORT" "driver=$DB_DRIVER"
    fi
  elif [[ -f "$base/database-query/config.json" ]]; then
    ok "database-query/config.json 已存在，保留不覆盖"
  else
    warn "$base/database-query/ 未生成 config.json（未配置数据库）"
  fi
  # md-to-wiki（wiki 发布；连接配置默认留空 enabled=false，未配置前 skill 不启动）
  cp "$TPL_DIR/md-to-wiki/SKILL.md.tpl"             "$base/md-to-wiki/SKILL.md"
  cp "$TPL_DIR/md-to-wiki/scripts/md_to_wiki.py"    "$base/md-to-wiki/scripts/md_to_wiki.py"
  if [[ -f "$base/md-to-wiki/wiki-config.json" ]]; then
    ok "md-to-wiki -> $base/md-to-wiki（wiki-config.json 已存在，保留不覆盖）"
  else
    cp "$TPL_DIR/md-to-wiki/wiki-config.json.tpl" "$base/md-to-wiki/wiki-config.json"
    ok "md-to-wiki -> $base/md-to-wiki（wiki-config.json 默认留空）"
  fi
  # create-tech-md-doc / create-release-md-doc（生成 md；--prd 依赖 wiki 配置，未配置自动回退）
  cp "$TPL_DIR/create-tech-md-doc/SKILL.md.tpl"     "$base/create-tech-md-doc/SKILL.md"
  cp "$TPL_DIR/create-tech-md-doc/template.md"      "$base/create-tech-md-doc/template.md"
  cp "$TPL_DIR/create-release-md-doc/SKILL.md.tpl"  "$base/create-release-md-doc/SKILL.md"
  cp "$TPL_DIR/create-release-md-doc/template.md"   "$base/create-release-md-doc/template.md"
  ok "create-tech-md-doc / create-release-md-doc -> $base"
  # dev（开发 / 修 bug 编排；profile.json 记录项目构建与测试命令，可提交，重跑不覆盖）
  cp "$TPL_DIR/dev/SKILL.md.tpl"                    "$base/dev/SKILL.md"
  cp "$TPL_DIR/dev/references/plan-template.md"     "$base/dev/references/plan-template.md"
  if [[ -f "$base/dev/profile.json" ]]; then
    ok "dev -> $base/dev（profile.json 已存在，保留不覆盖）"
  else
    cp "$TPL_DIR/dev/profile.json.tpl" "$base/dev/profile.json"
    ok "dev -> $base/dev（profile.json 首次使用时由 agent 推断并经你确认后填写）"
  fi
}

# ---------------- 4. .gitignore 保护（无论是否配置数据库都执行：wiki 凭据与 tmp 产物同样需要忽略）
update_gitignore() {
  local gi="$ROOT_DIR/.gitignore" rule
  local missing=()
  for rule in '**/database-query/config.json' '**/wiki-config.json' '/tmp/'; do
    if [[ -f "$gi" ]] && grep -qxF "$rule" "$gi"; then continue; fi
    missing+=("$rule")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then ok ".gitignore 已包含全部规则"; return; fi
  {
    printf '\n# Agent skills generated rules (credentials + tmp artifacts; do not commit)\n'
    printf '%s\n' "${missing[@]}"
  } >> "$gi"
  ok ".gitignore 已追加：${missing[*]}"
}

# ================================================================= main
SEL=()
while IFS= read -r line; do [[ -n "$line" ]] && SEL+=("$line"); done < <(resolve_env)  # bash 3.2 无 mapfile
step "目标环境：${SEL[*]}"

HAS_DB=0
if [[ "$SKIP_DB" == "0" ]]; then
  if [[ "$YES" == "1" && -z "$(find_existing_db_config)" ]]; then
    echo "错误: 非交互模式(--yes)但未找到已有数据库配置（.codex/ 或各环境 database-query/config.json），请去掉 --yes 手动输入，或加 --skip-db。" >&2
    exit 1
  fi
  if get_db; then HAS_DB=1; fi
fi

TARGETS=()
for e in "${SEL[@]}"; do
  case "$e" in
    codex)  TARGETS+=("codex|.agents/skills") ;;
    claude) TARGETS+=("claude|.claude/skills") ;;
    doubao) TARGETS+=("doubao|.agents/skills") ;;
    qwen)   TARGETS+=("qwen|.qwen/skills") ;;
  esac
done

if [[ " ${SEL[*]} " == *" codex "* && "$YES" == "0" ]]; then
  printf '是否同时安装到 Codex 用户级 ~/.codex/skills（所有项目可用）？[y/N]: '
  read -r a
  if [[ "$(lower "$a")" == "y" ]]; then
    TARGETS+=("codex(user)|${HOME}/.codex/skills")
  fi
fi

for t in "${TARGETS[@]}"; do
  IFS='|' read -r ename dir <<< "$t"
  case "$dir" in
    /*) abs="$dir" ;;
    *)  abs="$ROOT_DIR/$dir" ;;
  esac
  step "安装到 $ename  ->  $abs"
  install_skills "$abs" "$HAS_DB"
done

update_gitignore

step "安装完成，启用方式"
echo '  codex     : 重启 codex 后自动发现项目级 skills（.agents/skills）；也可 /use code-review 手动加载'
echo '  claude    : Claude Code 自动发现 .claude/skills，无需额外配置'
echo '  doubao    : 豆包办公自动发现 .agents/skills（新会话生效）'
echo '  qwen      : Qwen Code 自动发现 .qwen/skills；/skills 面板可查看与切换'
if [[ "$HAS_DB" == "0" ]]; then
  warn '注意：本次未写入数据库连接。可重跑本脚本补配，或在各环境 database-query/config.json 手动放置连接配置（已有的保留不动）。'
else
  ok 'database-query 连接已生成并写入各环境；凭据已加入 .gitignore，请勿提交。'
fi
warn '注意：md-to-wiki 的 wiki 连接（wiki-config.json）默认留空（enabled=false），未配置前 md-to-wiki 与 create-*-md-doc 的 --prd 增强不启动。'
warn '        启用方法：填写各环境 md-to-wiki/wiki-config.json（enabled: true + base_url + api_token），或接入对应环境的 wiki MCP。重跑本脚本不会覆盖已填写的配置。'
echo '模板与说明：skills-init/README.md'
