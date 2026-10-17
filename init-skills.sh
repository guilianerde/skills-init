#!/usr/bin/env bash
# =====================================================================
# init-skills.sh — 项目级 Agent Skills 一键初始化（薄封装）
#
# 实际逻辑在 bin/skills-init.mjs（Node >= 22，跨平台单一实现）。安装器放在项目外任意位置（不要放进项目的
# skills-init/，那是本工具放产出的目录），在项目根执行，以当前目录为项目根，参数原样透传：
#   <安装器>/init-skills.sh                                   # 交互式
#   <安装器>/init-skills.sh --envs all --yes --skip-db        # 全环境、非交互、跳过数据库
#   <安装器>/init-skills.sh --envs claude,qwen --with-docnexus
#   <安装器>/init-skills.sh --envs all --copy                 # 不用软链接
#   <安装器>/init-skills.sh --uninstall                       # 按安装清单卸载
#   <安装器>/init-skills.sh upgrade                           # 子命令：upgrade / doctor / uninstall / seed-templates / report / view
# 完整参数：<安装器>/init-skills.sh --help
# =====================================================================
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 需要 Node.js >= 22（未找到 node）。安装后重试：https://nodejs.org/" >&2
  exit 1
fi
exec node "$SCRIPT_DIR/bin/skills-init.mjs" --project-root "$ROOT_DIR" "$@"
