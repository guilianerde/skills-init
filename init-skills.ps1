# =====================================================================
# init-skills.ps1 — 项目级 Agent Skills 一键初始化（薄封装）
#
# 实际逻辑在 bin\skills-init.mjs（Node >= 22，跨平台单一实现）。安装器放在项目外任意位置（不要放进项目的
# skills-init\，那是本工具放产出的目录），在项目根执行，以当前目录为项目根：
#   <安装器>\init-skills.ps1                                  # 交互式
#   <安装器>\init-skills.ps1 -Envs all -Yes -SkipDb           # 全环境、非交互、跳过数据库
#   <安装器>\init-skills.ps1 -Envs claude,qwen -WithDocNexus
#   <安装器>\init-skills.ps1 -Envs all -Copy                  # 不用软链接
#   <安装器>\init-skills.ps1 -Uninstall                       # 按安装清单卸载
#   <安装器>\init-skills.ps1 upgrade                          # 子命令：upgrade / doctor / uninstall / seed-templates / report / view
#   <安装器>\init-skills.ps1 report -Since 2026-10-01         # 本地效果报告
#   <安装器>\init-skills.ps1 view -Open                       # 项目文档视图（本地静态页面）
# Windows 建软链接需开启「开发者模式」或以管理员运行；建不了时该环境自动退回独立拷贝。
# =====================================================================

param(
  [Parameter(Position = 0)]
  [ValidateSet('', 'init', 'upgrade', 'doctor', 'uninstall', 'seed-templates', 'report', 'view')]
  [string]$Command = '',       # 子命令：init（默认）/ upgrade / doctor / uninstall / seed-templates / report / view
  [string]$Envs = "",          # 逗号分隔环境：codex,claude,doubao,qwen 或 all
  [switch]$SkipDb,             # 跳过数据库连接配置
  [switch]$Yes,                # 非交互模式：使用已有数据库配置；无配置且未 SkipDb 时报错退出
  [switch]$WithDocNexus,       # 安装 @rowansenne/docnexus 并执行 docnexus init（需 Node >= 22.13）
  [switch]$WithCodeGraph,      # 接入 CodeGraph 代码图谱（npm 全局安装 codegraph、写 MCP 配置、建索引）
  [switch]$Copy,               # 不用软链接，每个环境各拷一份
  [switch]$SeedTemplates,      # 把自带的文档模板导入 DocNexus
  [switch]$Offline,            # doctor：不测试数据库连通性
  [switch]$Update,             # seed-templates：把导入后未改动的模板更新为新版
  [switch]$Diff,               # seed-templates：只读打印团队改过的模板与新默认模板的差异
  [string]$Since = "",         # report：只统计该日期（YYYY-MM-DD）起的产物
  [switch]$Json,               # report：输出 JSON
  [switch]$AllBranches,        # report：同时扫描所有本地分支里的产物（只读 git）
  [string]$Out = "",           # view：页面写到哪里（默认 skills-init/tmp/view/index.html）
  [switch]$Open,               # view：生成后用默认浏览器打开
  [switch]$Uninstall           # 按安装清单卸载本项目装的 skills 与链接（用户配置备份到 skills-init\tmp\uninstall-backup\）
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = (Get-Location).Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '错误: 需要 Node.js >= 22（未找到 node）。安装后重试：https://nodejs.org/' -ForegroundColor Red
  exit 1
}

$cliArgs = @((Join-Path $ScriptDir 'bin\skills-init.mjs'), '--project-root', $Root)
if ($Command)      { $cliArgs += $Command }
if ($Envs)         { $cliArgs += @('--envs', $Envs) }
if ($SkipDb)       { $cliArgs += '--skip-db' }
if ($Yes)          { $cliArgs += '--yes' }
if ($WithDocNexus) { $cliArgs += '--with-docnexus' }
if ($WithCodeGraph) { $cliArgs += '--with-codegraph' }
if ($Copy)         { $cliArgs += '--copy' }
if ($SeedTemplates) { $cliArgs += '--seed-templates' }
if ($Offline)      { $cliArgs += '--offline' }
if ($Update)       { $cliArgs += '--update' }
if ($Diff)         { $cliArgs += '--diff' }
if ($Since)        { $cliArgs += @('--since', $Since) }
if ($Json)         { $cliArgs += '--json' }
if ($AllBranches)  { $cliArgs += '--all-branches' }
if ($Out)          { $cliArgs += @('--out', $Out) }
if ($Open)         { $cliArgs += '--open' }
if ($Uninstall)    { $cliArgs += '--uninstall' }

& node @cliArgs
exit $LASTEXITCODE
