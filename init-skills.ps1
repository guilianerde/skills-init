# =====================================================================
# init-skills.ps1 — 项目级 Agent Skills 一键初始化（薄封装）
#
# 实际逻辑在 bin\skills-init.mjs（Node >= 18，跨平台单一实现）。本脚本固定位于
# <项目根>\skills-init\ 下，以上级目录为项目根：
#   .\skills-init\init-skills.ps1                                  # 交互式
#   .\skills-init\init-skills.ps1 -Envs all -Yes -SkipDb           # 全环境、非交互、跳过数据库
#   .\skills-init\init-skills.ps1 -Envs claude,qwen -WithDocNexus
#   .\skills-init\init-skills.ps1 -Envs all -Copy                  # 不用软链接
#   .\skills-init\init-skills.ps1 -Uninstall                       # 按安装清单卸载
#   .\skills-init\init-skills.ps1 upgrade                          # 子命令：upgrade / doctor / uninstall / seed-templates
# Windows 建软链接需开启「开发者模式」或以管理员运行；建不了时该环境自动退回独立拷贝。
# =====================================================================

param(
  [Parameter(Position = 0)]
  [ValidateSet('', 'init', 'upgrade', 'doctor', 'uninstall', 'seed-templates')]
  [string]$Command = '',       # 子命令：init（默认）/ upgrade / doctor / uninstall / seed-templates
  [string]$Envs = "",          # 逗号分隔环境：codex,claude,doubao,qwen 或 all
  [switch]$SkipDb,             # 跳过数据库连接配置
  [switch]$Yes,                # 非交互模式：使用已有数据库配置；无配置且未 SkipDb 时报错退出
  [switch]$WithDocNexus,       # 安装 @rowansenne/docnexus 并执行 docnexus init（需 Node >= 22.13）
  [switch]$Copy,               # 不用软链接，每个环境各拷一份
  [switch]$SeedTemplates,      # 把自带的文档模板导入 DocNexus
  [switch]$Offline,            # doctor：不测试数据库连通性
  [switch]$Uninstall           # 按安装清单卸载本项目装的 skills 与链接（用户配置备份到 tmp\skills\uninstall-backup\）
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '错误: 需要 Node.js >= 18（未找到 node）。安装后重试：https://nodejs.org/' -ForegroundColor Red
  exit 1
}

$cliArgs = @((Join-Path $ScriptDir 'bin\skills-init.mjs'), '--project-root', $Root)
if ($Command)      { $cliArgs += $Command }
if ($Envs)         { $cliArgs += @('--envs', $Envs) }
if ($SkipDb)       { $cliArgs += '--skip-db' }
if ($Yes)          { $cliArgs += '--yes' }
if ($WithDocNexus) { $cliArgs += '--with-docnexus' }
if ($Copy)         { $cliArgs += '--copy' }
if ($SeedTemplates) { $cliArgs += '--seed-templates' }
if ($Offline)      { $cliArgs += '--offline' }
if ($Uninstall)    { $cliArgs += '--uninstall' }

& node @cliArgs
exit $LASTEXITCODE
