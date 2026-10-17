# =====================================================================
# init-skills.ps1 冒烟测试（PowerShell 7 / Windows）：只验证封装脚本本身——以上级目录为项目根、
# 开关与子命令（位置参数）正确转成 CLI 参数、stdin 交互可用。安装逻辑的完整场景在 tests/test-install.mjs。
#
# 用法：
#   pwsh -NoProfile -File tests/test-init-skills.ps1            # 跑全部用例
#   pwsh -NoProfile -File tests/test-init-skills.ps1 upgrade    # 只跑名字含 upgrade 的用例
# 软链接不可用时（未开开发者模式且非管理员）链接类用例按「退回独立拷贝」断言；
# 用 SKILLS_INIT_NO_SYMLINK=1 强制覆盖退回分支。
# =====================================================================

param([string]$Filter = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

$Repo   = Split-Path -Parent $PSScriptRoot
$Skills = @('workflow','dev','project-review','database-query','md-to-wiki','create-tech-md-doc','create-release-md-doc')
$Work   = Join-Path ([IO.Path]::GetTempPath()) ("skills-init-test-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Work | Out-Null

$script:P = $null; $script:Log = $null; $script:Rc = $null; $script:CaseFailed = $false
$Password = 'p/a&s|s"w\o\"rd\'

function Fail([string]$msg) { Write-Host "    FAIL  $msg" -ForegroundColor Red; $script:CaseFailed = $true }
function PathOf([string]$rel) { Join-Path $script:P $rel }
function ItemOf([string]$rel) { Get-Item -LiteralPath (PathOf $rel) -Force -ErrorAction SilentlyContinue }

function Assert-File([string]$rel) {
  $i = ItemOf $rel
  if (-not $i -or $i.PSIsContainer -or $i.LinkType) { Fail "应为普通文件: $rel" }
}
function Assert-Dir([string]$rel) {
  $i = ItemOf $rel
  if (-not $i -or -not $i.PSIsContainer -or $i.LinkType) { Fail "应为真实目录: $rel" }
}
function Assert-Missing([string]$rel) { if (ItemOf $rel) { Fail "不应存在: $rel" } }
function Assert-Link([string]$rel, [string]$target) {
  # 软链接或 junction 均可，只要解析后指向期望的目录（$target 相对链接所在目录）
  $i = ItemOf $rel
  if (-not $i -or $i.LinkType -notin 'SymbolicLink', 'Junction') { Fail "应为链接: $rel"; return }
  $parent = Split-Path -Parent (PathOf $rel)
  $actual = [IO.Path]::GetFullPath((Join-Path $parent ([string]$i.Target))).TrimEnd('\', '/')
  $want   = [IO.Path]::GetFullPath((Join-Path $parent $target)).TrimEnd('\', '/')
  if ($actual -ne $want) { Fail "$rel -> $($i.Target)，期望 -> $target" }
  if (-not (Test-Path -LiteralPath (Join-Path (PathOf $rel) 'SKILL.md'))) { Fail "软链接目标不可读: $rel" }
}
function Assert-Same([string]$rel, [string]$expected) {
  $a = PathOf $rel
  if (-not (Test-Path -LiteralPath $a -PathType Leaf)) { Fail "缺少文件: $rel"; return }
  if ((Get-FileHash -LiteralPath $a).Hash -ne (Get-FileHash -LiteralPath $expected).Hash) { Fail "$rel 内容与 $expected 不同" }
}
function Assert-Content([string]$rel, [string]$expected) {
  $a = PathOf $rel
  $v = if (Test-Path -LiteralPath $a) { (Get-Content -LiteralPath $a -Raw).TrimEnd("`r", "`n") } else { '<missing>' }
  if ($v -ne $expected) { Fail "$rel 内容不符：$v" }
}
function Assert-Eq($actual, $expected, [string]$what) {
  if ([string]$actual -cne [string]$expected) { Fail "$what：实际 [$actual]，期望 [$expected]" }
}
function Expect-Rc([int]$rc) {
  if ($script:Rc -ne $rc) {
    Fail "退出码 $($script:Rc)，期望 $rc"
    Get-Content -LiteralPath $script:Log -Tail 25 | ForEach-Object { Write-Host "        | $_" }
  }
}

# 当前工作区的副本放到 $dst（实现换成什么都按原样带上；除 git / CI / 测试本身）
function Copy-Installer([string]$dst) {
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Get-ChildItem -LiteralPath $Repo -Force | Where-Object { $_.Name -notin '.git', '.github', '.claude', 'tests', 'tmp' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force }
}
# 新建项目 $P；安装器副本放在项目外 $Inst
function New-Project([string]$name) {
  $script:P    = Join-Path $Work $name
  $script:Log  = Join-Path $Work "$name.log"
  $script:Inst = Join-Path $Work "installer-$name"
  New-Item -ItemType Directory -Force -Path $script:P | Out-Null
  Copy-Installer $script:Inst
}

# 独立 pwsh 进程在项目根执行安装脚本；$stdin 为交互输入（多行字符串），退出码写入 $script:Rc
function Invoke-Install([string[]]$installArgs, [string]$stdin = '', [string]$scriptPath = (Join-Path $script:Inst 'init-skills.ps1')) {
  Push-Location $script:P
  try {
    $out = $stdin | & pwsh -NoProfile -File $scriptPath @installArgs 2>&1
    $script:Rc = $LASTEXITCODE
  } finally { Pop-Location }
  $out | ForEach-Object { [string]$_ } | Add-Content -LiteralPath $script:Log -Encoding utf8
}

function Get-Json([string]$rel) { Get-Content -LiteralPath (PathOf $rel) -Raw | ConvertFrom-Json }

function Test-SymlinkSupported {
  $dir  = Join-Path $Work 'symlink-probe'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $link = Join-Path $dir 'link'
  try { [IO.Directory]::CreateSymbolicLink($link, '.') | Out-Null } catch { }
  return [bool](Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue)
}
$SymlinkOk = ($env:SKILLS_INIT_NO_SYMLINK -ne '1') -and (Test-SymlinkSupported)

# 链接环境的断言：软链接可用时应全部是指向单一来源的链接，否则应为独立拷贝
function Assert-EnvLinked([string]$rel) {
  foreach ($s in $Skills) {
    if ($SymlinkOk) { Assert-Link "$rel\$s" "..\..\.agents\skills\$s" }
    else { Assert-Dir "$rel\$s"; Assert-File "$rel\$s\SKILL.md" }
  }
}

function Get-DbAnswers { "mysql`n127.0.0.1`n3307`nappdb`nroot`n$Password`n" }

# =====================================================================
function Test-WrapperInstallsIntoCurrentDir {
  New-Project 'fresh'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  foreach ($s in $Skills) { Assert-File ".agents\skills\$s\SKILL.md" }
  Assert-EnvLinked '.claude\skills'
  Assert-EnvLinked '.qwen\skills'
  if (Test-Path -LiteralPath (Join-Path $script:Inst '.agents')) { Fail '装到了安装器目录里' }
  # 旧用法：安装器克隆在项目的 skills-init\（现在是放产出的目录）→ 停下并提示挪走，不做改动
  New-Project 'old-layout'
  Copy-Installer (Join-Path $script:P 'skills-init')
  Invoke-Install @('-Envs', 'claude', '-Yes', '-SkipDb') '' 'skills-init\init-skills.ps1'; Expect-Rc 1
  if (-not (Select-String -LiteralPath $script:Log -SimpleMatch '安装器移到项目外' -Quiet)) { Fail '缺少挪走安装器的提示' }
  Assert-Missing '.agents\skills'
}

function Test-NoSymlinkFallsBackToCopy {
  New-Project 'no-symlink'
  $env:SKILLS_INIT_NO_SYMLINK = '1'
  try {
    Invoke-Install @('-Envs', 'claude', '-Yes', '-SkipDb'); Expect-Rc 0
  } finally { Remove-Item Env:SKILLS_INIT_NO_SYMLINK }
  foreach ($s in $Skills) { Assert-Dir ".claude\skills\$s"; Assert-File ".claude\skills\$s\SKILL.md" }
}

function Test-SwitchesPassThrough {
  New-Project 'switches'
  Invoke-Install @('-Envs', 'claude,qwen', '-Copy', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Dir '.claude\skills\workflow'
  Assert-Missing '.agents\skills'
  New-Project 'switches-yes'
  Invoke-Install @('-Envs', 'claude', '-Yes'); Expect-Rc 1
  Assert-Missing '.agents\skills'
}

function Test-InteractiveStdin {
  New-Project 'password'
  Invoke-Install @('-Envs', 'claude') (Get-DbAnswers); Expect-Rc 0
  Assert-Eq (Get-Json '.agents\skills\database-query\config.json').connections.default.password $Password 'config.json 中的密码'
}

function Test-SubcommandsPassThrough {
  New-Project 'subcommands'
  Invoke-Install @('-Envs', 'claude', '-Yes', '-SkipDb'); Expect-Rc 0
  Set-Content -LiteralPath $script:Log -Value ''
  Invoke-Install @('doctor', '-Offline'); Expect-Rc 0
  if (-not (Select-String -LiteralPath $script:Log -SimpleMatch '0 个错误' -Quiet)) { Fail 'doctor 输出缺少汇总' }
  Invoke-Install @('upgrade'); Expect-Rc 0
  if (-not (Select-String -LiteralPath $script:Log -SimpleMatch '升级：' -Quiet)) { Fail 'upgrade 输出缺少版本信息' }
  Invoke-Install @('report', '-Since', '2026-01-01', '-Json'); Expect-Rc 0
  if (-not (Select-String -LiteralPath $script:Log -SimpleMatch '"since": "2026-01-01"' -Quiet)) { Fail 'report 未按 -Since / -Json 输出' }
  Invoke-Install @('-Uninstall'); Expect-Rc 0
  Assert-Missing '.agents\skills\workflow'
  Assert-Missing '.claude\skills\workflow'
}

# =====================================================================
Write-Host ("pwsh {0} on {1}；软链接可用：{2}" -f $PSVersionTable.PSVersion, [Environment]::OSVersion.VersionString, $SymlinkOk)
$tests = @(
  'Test-WrapperInstallsIntoCurrentDir', 'Test-NoSymlinkFallsBackToCopy', 'Test-SwitchesPassThrough',
  'Test-InteractiveStdin', 'Test-SubcommandsPassThrough'
)
$passed = 0; $failedCases = @()
try {
  foreach ($t in $tests) {
    if ($Filter -and $t -notlike "*$Filter*") { continue }
    $script:CaseFailed = $false
    Write-Host "--- $t"
    try { & $t } catch { Fail "异常：$($_.Exception.Message) @ $($_.InvocationInfo.PositionMessage)" }
    if ($script:CaseFailed) { $failedCases += $t } else { $passed++; Write-Host '    PASS' }
  }
} finally {
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "通过 $passed，失败 $($failedCases.Count)"
if ($failedCases.Count -gt 0) { $failedCases | ForEach-Object { Write-Host "  失败用例: $_" }; exit 1 }
exit 0
