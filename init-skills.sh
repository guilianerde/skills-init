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
#   ./skills-init/init-skills.sh --envs claude,qwen --with-docnexus  # 同时接入 DocNexus 文档库（需 Node >= 22.13）
#   ./skills-init/init-skills.sh --envs all --copy                 # 不用软链接，每个环境各拷一份
#
# 单一来源：skills 只完整安装到 .agents/skills（codex / doubao 直接使用）；
#           .claude/skills、.qwen/skills 下按 skill 建相对软链接指向它。--copy 退回各环境独立拷贝。
#
# 重跑安全：SKILL.md / references 模板会更新；用户已填写的 wiki-config.json、
#           schema.md、workflow/profile.json 保留不覆盖；database-query/config.json 仅在本次提供了数据库配置时写入。
# =====================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TPL_DIR="$SCRIPT_DIR"
ENVS_ARG=""
SKIP_DB=0
YES=0
WITH_DOCNEXUS=0
COPY_MODE=0
CANON_DIR=".agents/skills"   # 单一来源目录
SKILLS=(workflow dev code-review database-query md-to-wiki create-tech-md-doc create-release-md-doc)
# 各 skill 内的用户配置（相对 skill 目录），迁移旧的独立拷贝时需要保留
USER_FILES=(database-query/config.json database-query/references/schema.md md-to-wiki/wiki-config.json workflow/profile.json)
# DocNexus 安装来源：默认 npm 包；可用环境变量指向本地 tarball / 目录（离线或测试用）
DOCNEXUS_PKG="${DOCNEXUS_PKG:-@rowansenne/docnexus}"

# ---------------- 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    --envs)   ENVS_ARG="${2:-}"; shift 2 ;;
    --skip-db) SKIP_DB=1; shift ;;
    --yes)    YES=1; shift ;;
    --with-docnexus) WITH_DOCNEXUS=1; shift ;;
    --copy)   COPY_MODE=1; shift ;;
    -h|--help)
      echo "用法: ./init-skills.sh [--envs codex,claude,doubao,qwen|all] [--skip-db] [--yes] [--with-docnexus] [--copy]"; exit 0 ;;
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
           "$base/dev/references" "$base/workflow"
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
  # dev（开发 / 修 bug 编排）
  cp "$TPL_DIR/dev/SKILL.md.tpl"                    "$base/dev/SKILL.md"
  cp "$TPL_DIR/dev/references/plan-template.md"     "$base/dev/references/plan-template.md"
  ok "dev -> $base/dev"
  # workflow（入口路由 + 共用项目画像 profile.json：无凭据，可提交，重跑不覆盖）
  cp "$TPL_DIR/workflow/SKILL.md.tpl"               "$base/workflow/SKILL.md"
  if [[ -f "$base/workflow/profile.json" ]]; then
    ok "workflow -> $base/workflow（profile.json 已存在，保留不覆盖）"
  elif [[ -f "$base/dev/profile.json" ]]; then
    # 旧版本画像放在 dev/ 下：字段兼容，原样迁移（新增字段缺失时视为空）
    mv "$base/dev/profile.json" "$base/workflow/profile.json"
    ok "workflow -> $base/workflow（已把旧的 dev/profile.json 迁移为 workflow/profile.json）"
  else
    cp "$TPL_DIR/workflow/profile.json.tpl" "$base/workflow/profile.json"
    ok "workflow -> $base/workflow（profile.json 首次使用时由 agent 推断并经你确认后填写）"
  fi
}

# ---------------- 3b. 软链接到单一来源（.claude/skills、.qwen/skills -> .agents/skills）
# 画像里没有任何非空字符串值 = 未填写过（新旧版本的空模板字段不同，不能按模板逐字比较）
profile_unfilled() { ! grep -qE '"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+' "$1"; }
is_blank_user_file() { # $1=用户配置（相对 skills 目录）  $2=文件；判断单一来源里的该文件是否还没被填写过
  case "$1" in
    md-to-wiki/wiki-config.json) cmp -s "$2" "$TPL_DIR/md-to-wiki/wiki-config.json.tpl" ;;
    workflow/profile.json)       profile_unfilled "$2" ;;
    *) return 1 ;;
  esac
}

migrate_copy() { # $1=旧的独立拷贝目录  $2=skill 名；把其中用户配置并入单一来源，冲突返回 1
  local old="$1" skill="$2" rel src dst
  for rel in "${USER_FILES[@]}"; do
    [[ "$rel" == "$skill/"* ]] || continue
    src="$old/${rel#*/}"; dst="$ROOT_DIR/$CANON_DIR/$rel"
    [[ -f "$src" ]] || continue
    is_blank_user_file "$rel" "$src" && continue   # 旧拷贝里没填写过：以单一来源为准
    if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst" && ! is_blank_user_file "$rel" "$dst"; then
      warn "$old 与 $CANON_DIR/$skill 的 ${rel#*/} 内容不同，无法自动合并：保留旧目录、未建链接。请手动合并后删除旧目录再重跑。"
      return 1
    fi
    mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"
  done
  # 旧版本画像在 dev/profile.json：单一来源里的 workflow/profile.json 还是空模板时迁移过去
  # 旧画像未填写过时直接忽略
  if [[ "$skill" == "dev" && -f "$old/profile.json" ]] && ! profile_unfilled "$old/profile.json"; then
    dst="$ROOT_DIR/$CANON_DIR/workflow/profile.json"
    if [[ ! -f "$dst" ]] || profile_unfilled "$dst"; then
      mkdir -p "$(dirname "$dst")"; cp "$old/profile.json" "$dst"
    elif ! cmp -s "$old/profile.json" "$dst"; then
      warn "$old/profile.json 与 $CANON_DIR/workflow/profile.json 都填写过且内容不同：未迁移，旧文件会随目录备份，请手动合并。"
    fi
  fi
  return 0
}

link_skills() { # $1=环境名  $2=相对项目根的 skills 目录（深度固定两级，如 .claude/skills）
  local ename="$1" rel="$2" dir skill link target bak skipped=0
  dir="$ROOT_DIR/$rel"; mkdir -p "$dir"
  for skill in "${SKILLS[@]}"; do
    link="$dir/$skill"; target="../../$CANON_DIR/$skill"
    if [[ -L "$link" ]]; then
      [[ "$(readlink "$link")" == "$target" ]] && continue
      rm -f "$link"
    elif [[ -d "$link" ]]; then
      migrate_copy "$link" "$skill" || { skipped=$((skipped + 1)); continue; }
      bak="$ROOT_DIR/tmp/skills/backup/$(date +%Y%m%d-%H%M%S)/$ename"
      mkdir -p "$bak"; mv "$link" "$bak/$skill"
      ok "$rel/$skill 旧的独立拷贝已并入单一来源，原目录备份到 ${bak#$ROOT_DIR/}/$skill"
    elif [[ -e "$link" ]]; then
      warn "$link 已存在且不是目录或软链接，跳过"; skipped=$((skipped + 1)); continue
    fi
    ln -s "$target" "$link"
  done
  if [[ "$skipped" == "0" ]]; then
    ok "$ename -> $rel（软链接到 $CANON_DIR）"
  else
    warn "$ename -> $rel：$skipped 个 skill 未建链接（见上方提示），其余已软链接到 $CANON_DIR"
  fi
}

# ---------------- 4. .gitignore 保护（无论是否配置数据库都执行：wiki 凭据与 tmp 产物同样需要忽略）
update_gitignore() {
  local gi="$ROOT_DIR/.gitignore" rule
  local missing=() rules=('**/database-query/config.json' '**/wiki-config.json' '/tmp/')
  [[ "$WITH_DOCNEXUS" == "1" ]] && rules+=('node_modules/')
  for rule in "${rules[@]}"; do
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

# ---------------- 5. DocNexus 文档库（可选，--with-docnexus）
check_node() { # Node >= 22.13
  local v major minor
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "错误: --with-docnexus 需要 Node >= 22.13 与 npm，但未找到 node/npm。请安装后重试，或去掉 --with-docnexus。" >&2
    exit 1
  fi
  v="$(node -v)"; v="${v#v}"
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  if [[ ! "$major" =~ ^[0-9]+$ || ! "$minor" =~ ^[0-9]+$ ]] || (( major < 22 || (major == 22 && minor < 13) )); then
    echo "错误: --with-docnexus 需要 Node >= 22.13，当前为 v$v。请升级 Node 后重试，或去掉 --with-docnexus。" >&2
    exit 1
  fi
  ok "Node v$v"
}

docnexus_agent() { # 所选环境 -> docnexus init --agent 取值（doubao 与 codex 共用 .agents；qwen 不受 docnexus 支持）
  local c=0 x=0
  [[ " ${SEL[*]} " == *" claude "* ]] && c=1
  [[ " ${SEL[*]} " == *" codex "* || " ${SEL[*]} " == *" doubao "* ]] && x=1
  if   [[ "$c$x" == "11" ]]; then echo all
  elif [[ "$c" == "1" ]]; then echo claude
  elif [[ "$x" == "1" ]]; then echo codex
  else echo none
  fi
}

link_qwen_docnexus() { # docnexus 不支持 qwen：把 docnexus/skills/* 软链接到 .qwen/skills/
  local src_root="$ROOT_DIR/docnexus/skills" dst="$ROOT_DIR/.qwen/skills" d name link n=0
  mkdir -p "$dst"
  for d in "$src_root"/*/; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"; link="$dst/$name"
    if [[ -e "$link" && ! -L "$link" ]]; then
      warn "$link 已存在且不是软链接，跳过（如需改用 DocNexus 版本请先移除）"; continue
    fi
    rm -f "$link"
    ln -s "../../docnexus/skills/$name" "$link"   # 相对路径，与 docnexus 对 .claude/.agents 的链接方式一致
    n=$((n + 1))
  done
  ok "qwen：已链接 $n 个 DocNexus skill -> .qwen/skills（docnexus 本身不支持 qwen，由本脚本补链）"
}

setup_docnexus() {
  local agent
  agent="$(docnexus_agent)"
  step "接入 DocNexus（npm i -D $DOCNEXUS_PKG；docnexus init --agent $agent）"
  [[ -f "$ROOT_DIR/package.json" ]] || warn "项目根没有 package.json，npm 会新建一个（仅记录 devDependency）"
  if ! (cd "$ROOT_DIR" && npm i -D "$DOCNEXUS_PKG"); then
    warn "npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）"; DOCNEXUS_RESULT=failed; return
  fi
  if [[ ! -x "$ROOT_DIR/node_modules/.bin/docnexus" ]]; then
    warn "未找到 ./node_modules/.bin/docnexus，已跳过 DocNexus 接入"; DOCNEXUS_RESULT=failed; return
  fi
  if ! (cd "$ROOT_DIR" && ./node_modules/.bin/docnexus init --agent "$agent" >/dev/null); then
    warn "docnexus init 失败，已跳过 DocNexus 接入（可在项目根手动执行 ./node_modules/.bin/docnexus init --agent $agent）"
    DOCNEXUS_RESULT=failed; return
  fi
  ok "docnexus init 完成：docnexus/ 工作区 + skills（docnexus/skills）"
  case "$agent" in
    all)    ok "已链接到 .claude/skills 与 .agents/skills，并写入 CLAUDE.md / AGENTS.md 的 DocNexus 段落" ;;
    claude) ok "已链接到 .claude/skills，并写入 CLAUDE.md 的 DocNexus 段落" ;;
    codex)  ok "已链接到 .agents/skills，并写入 AGENTS.md 的 DocNexus 段落" ;;
  esac
  [[ " ${SEL[*]} " == *" doubao "* ]] && ok "doubao 与 codex 共用 .agents/skills，按 codex 接入"
  if [[ " ${SEL[*]} " == *" qwen "* ]]; then
    link_qwen_docnexus
    if [[ "$agent" == "codex" || "$agent" == "all" ]]; then
      warn "qwen：docnexus 不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md"
    else
      warn "qwen：docnexus 不会写 QWEN.md；需要自动召回时可执行 ./node_modules/.bin/docnexus init --agent codex 生成 AGENTS.md 的 DocNexus 段落，再在 QWEN.md 引用它或在 .qwen/settings.json 的 context.fileName 加入 AGENTS.md（会同时链接到 .agents/skills）"
    fi
  fi
  DOCNEXUS_RESULT=ok
}

# ================================================================= main
DOCNEXUS_RESULT=skipped
[[ "$WITH_DOCNEXUS" == "1" ]] && { step "检查 DocNexus 依赖"; check_node; }

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

# 安装目标：单一来源模式下 .agents/skills 只装一次，其余环境建链接；--copy 时各环境各装一份
TARGETS=() LINKS=()
has_env() { [[ " ${SEL[*]} " == *" $1 "* ]]; }
if [[ "$COPY_MODE" == "1" ]]; then
  { has_env codex || has_env doubao; } && TARGETS+=("codex/doubao|$CANON_DIR")
  has_env claude && TARGETS+=("claude|.claude/skills")
  has_env qwen   && TARGETS+=("qwen|.qwen/skills")
else
  TARGETS+=("单一来源|$CANON_DIR")
  has_env claude && LINKS+=("claude|.claude/skills")
  has_env qwen   && LINKS+=("qwen|.qwen/skills")
fi

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

for t in ${LINKS[@]+"${LINKS[@]}"}; do
  IFS='|' read -r ename dir <<< "$t"
  step "链接 $ename  ->  $ROOT_DIR/$dir"
  link_skills "$ename" "$dir"
done

update_gitignore

[[ "$WITH_DOCNEXUS" == "1" ]] && setup_docnexus

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
case "$DOCNEXUS_RESULT" in
  ok)     ok 'DocNexus 已接入：dev / code-review 会按 docnexus-recall 查项目约定；任何写入 DocNexus 的操作都需你授权。' ;;
  failed) warn '注意：DocNexus 接入失败（见上方输出），其他 skills 不受影响；修复后可重跑本脚本（加 --with-docnexus）。' ;;
esac
echo '模板与说明：skills-init/README.md'
[[ "$DOCNEXUS_RESULT" == "failed" ]] && exit 1   # skills 已装好，但显式要求的 DocNexus 未接入：返回非 0 便于自动化感知
exit 0
