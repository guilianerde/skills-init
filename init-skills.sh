#!/usr/bin/env bash
# =====================================================================
# init-skills.sh — 项目级 Agent Skills 一键初始化（薄封装）
#
# 实际逻辑在 bin/skills-init.mjs（Node >= 18，跨平台单一实现）。本脚本固定位于
# <项目根>/skills-init/ 下，以上级目录为项目根，参数原样透传：
#   ./skills-init/init-skills.sh                                   # 交互式
#   ./skills-init/init-skills.sh --envs all --yes --skip-db        # 全环境、非交互、跳过数据库
#   ./skills-init/init-skills.sh --envs claude,qwen --with-docnexus
#   ./skills-init/init-skills.sh --envs all --copy                 # 不用软链接
#   ./skills-init/init-skills.sh --uninstall                       # 按安装清单卸载
# 完整参数：./skills-init/init-skills.sh --help
# =====================================================================
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 需要 Node.js >= 18（未找到 node）。安装后重试：https://nodejs.org/" >&2
  exit 1
fi
exec node "$SCRIPT_DIR/bin/skills-init.mjs" --project-root "$ROOT_DIR" "$@"
