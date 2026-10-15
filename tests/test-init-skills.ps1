# =====================================================================
# init-skills.ps1 黑盒测试（PowerShell 7 / Windows）：每个用例在临时目录放一份 skills-init 副本，
# 用独立的 pwsh 进程执行安装后断言结果。
#
# 用法：
#   pwsh -NoProfile -File tests/test-init-skills.ps1            # 跑全部用例
#   pwsh -NoProfile -File tests/test-init-skills.ps1 upgrade    # 只跑名字含 upgrade 的用例
# 升级用例需要 git 历史中的 71a23c8（CI 用 fetch-depth: 0）。
# 软链接不可用时（未开开发者模式且非管理员）链接类用例按「退回独立拷贝」断言；
# 用 SKILLS_INIT_NO_SYMLINK=1 强制覆盖退回分支。
# =====================================================================

param([string]$Filter = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

$Repo   = Split-Path -Parent $PSScriptRoot
$Skills = @('workflow','dev','project-review','database-query','md-to-wiki','create-tech-md-doc','create-release-md-doc')
$OldRev = '71a23c8'   # 单一来源之前的版本：各环境独立拷贝，画像在 dev\profile.json
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

function New-Project([string]$name) {
  $script:P   = Join-Path $Work $name
  $script:Log = Join-Path $Work "$name.log"
  $dst = Join-Path $script:P 'skills-init'
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  # 整个工作区（除 git / CI / 测试本身），实现换成什么都按原样带上
  Get-ChildItem -LiteralPath $Repo -Force | Where-Object { $_.Name -notin '.git', '.github', '.claude', 'tests' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force }
}

# 独立 pwsh 进程执行安装脚本；$stdin 为交互输入（多行字符串），退出码写入 $script:Rc
function Invoke-Install([string[]]$installArgs, [string]$stdin = '', [string]$scriptPath = 'skills-init\init-skills.ps1') {
  Push-Location $script:P
  try {
    $out = $stdin | & pwsh -NoProfile -File $scriptPath @installArgs 2>&1
    $script:Rc = $LASTEXITCODE
  } finally { Pop-Location }
  $out | ForEach-Object { [string]$_ } | Add-Content -LiteralPath $script:Log -Encoding utf8
}

# 用 git 历史中的旧版脚本生成旧布局（各环境独立拷贝），再换成当前版本的 skills-init
function New-OldLayout([string[]]$installArgs) {
  $dst = Join-Path $script:P 'skills-init'
  Remove-Item -LiteralPath $dst -Recurse -Force
  $zip = Join-Path $Work ("old-" + [Guid]::NewGuid().ToString('N') + '.zip')
  & git -C $Repo archive --format=zip -o $zip $OldRev
  if ($LASTEXITCODE -ne 0) { Fail "无法从 git 历史取出 $OldRev（CI 需 fetch-depth: 0）"; return $false }
  Expand-Archive -LiteralPath $zip -DestinationPath $dst
  Invoke-Install $installArgs
  if ($script:Rc -ne 0) { Fail '旧版脚本执行失败'; return $false }
  Remove-Item -LiteralPath $dst -Recurse -Force
  New-Project (Split-Path -Leaf $script:P)
  return $true
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

function Set-Profile([string]$rel, [string]$branch) {
  [IO.File]::WriteAllText((PathOf $rel), "{`n  `"main_branch`": `"$branch`",`n  `"build`": `"make`"`n}`n")
}
function Set-Wiki([string]$rel, [string]$url) {
  [IO.File]::WriteAllText((PathOf $rel), "{`n  `"enabled`": true,`n  `"wiki`": { `"base_url`": `"$url`" }`n}`n")
}
function Get-DbAnswers { "mysql`n127.0.0.1`n3307`nappdb`nroot`n$Password`n" }

# =====================================================================
function Test-FreshInstallLinks {
  New-Project 'fresh'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  foreach ($s in $Skills) { Assert-Dir ".agents\skills\$s"; Assert-File ".agents\skills\$s\SKILL.md" }
  Assert-EnvLinked '.claude\skills'
  Assert-EnvLinked '.qwen\skills'
  Assert-Same '.agents\skills\project-review\references\checklist.md' (Join-Path $Repo 'project-review\references\checklist.md.tpl')
  Assert-Same '.agents\skills\md-to-wiki\scripts\md_to_wiki.py' (Join-Path $Repo 'md-to-wiki\scripts\md_to_wiki.py')
  Assert-Same '.agents\skills\md-to-wiki\wiki-config.json' (Join-Path $Repo 'md-to-wiki\wiki-config.json.tpl')
  Assert-Same '.agents\skills\workflow\profile.json' (Join-Path $Repo 'workflow\profile.json.tpl')
  Assert-Missing '.agents\skills\database-query\config.json'
  # 重跑：链接已正确时保持不变
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-EnvLinked '.claude\skills'
  Assert-Missing 'tmp\skills\backup'
}

function Test-NoSymlinkFallsBackToCopy {
  New-Project 'no-symlink'
  $env:SKILLS_INIT_NO_SYMLINK = '1'
  try {
    Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  } finally { Remove-Item Env:SKILLS_INIT_NO_SYMLINK }
  foreach ($d in '.claude\skills', '.qwen\skills') {
    foreach ($s in $Skills) { Assert-Dir "$d\$s"; Assert-File "$d\$s\SKILL.md" }
    Assert-Same "$d\workflow\profile.json" (Join-Path $Repo 'workflow\profile.json.tpl')
  }
  Assert-Dir '.agents\skills\workflow'
}

function Test-NoSymlinkUpgradeKeepsOldCopies {
  New-Project 'no-symlink-upgrade'
  if (-not (New-OldLayout @('-Envs', 'all', '-Yes', '-SkipDb'))) { return }
  Set-Wiki '.claude\skills\md-to-wiki\wiki-config.json' 'https://wiki.example.com'
  Copy-Item -LiteralPath (PathOf '.claude\skills\md-to-wiki\wiki-config.json') -Destination (Join-Path $Work 'nsu-wiki.json')
  $env:SKILLS_INIT_NO_SYMLINK = '1'
  try {
    Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  } finally { Remove-Item Env:SKILLS_INIT_NO_SYMLINK }
  # 建不了链接时不动旧目录：用户配置原地保留、不做备份，模板照常更新
  Assert-Dir '.claude\skills\md-to-wiki'
  Assert-Same '.claude\skills\md-to-wiki\wiki-config.json' (Join-Path $Work 'nsu-wiki.json')
  Assert-Same '.claude\skills\dev\SKILL.md' (Join-Path $Repo 'dev\SKILL.md.tpl')
  Assert-File '.claude\skills\workflow\SKILL.md'
  Assert-Missing 'tmp\skills\backup'
}

function Test-CopyMode {
  New-Project 'copy'
  Invoke-Install @('-Envs', 'claude,qwen', '-Copy', '-Yes', '-SkipDb'); Expect-Rc 0
  foreach ($d in '.claude\skills', '.qwen\skills') {
    foreach ($s in $Skills) { Assert-Dir "$d\$s"; Assert-File "$d\$s\SKILL.md" }
    Assert-Same "$d\workflow\profile.json" (Join-Path $Repo 'workflow\profile.json.tpl')
  }
  # 没选 codex / doubao 时 -Copy 不装 .agents\skills
  Assert-Missing '.agents\skills'
}

function Test-YesWithoutDbConfigFails {
  New-Project 'yes-no-db'
  Invoke-Install @('-Envs', 'claude', '-Yes'); Expect-Rc 1
  Assert-Missing '.agents\skills'
}

function Test-InteractivePasswordEscaping {
  New-Project 'password'
  Invoke-Install @('-Envs', 'claude,qwen') (Get-DbAnswers); Expect-Rc 0
  $cfg = '.agents\skills\database-query\config.json'
  Assert-File $cfg
  $c = $null
  try { $c = (Get-Json $cfg).connections.default } catch { Fail "config.json 不是合法 JSON：$($_.Exception.Message)"; return }
  Assert-Eq $c.password $Password 'config.json 中的密码'
  Assert-Eq $c.port 3307 'config.json 中的端口'
  Assert-Eq $c.user 'root' 'config.json 中的用户'
  Assert-File '.agents\skills\database-query\references\schema.md'
  # -Yes 重跑复用已有配置，密码保持一致
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes'); Expect-Rc 0
  try { Assert-Eq (Get-Json $cfg).connections.default.password $Password '重跑后 config.json 中的密码' }
  catch { Fail "重跑后 config.json 不是合法 JSON：$($_.Exception.Message)" }
}

function Test-RerunPreservesUserFiles {
  New-Project 'rerun'
  Invoke-Install @('-Envs', 'claude,qwen') (Get-DbAnswers); Expect-Rc 0
  $c = '.agents\skills'
  Set-Wiki "$c\md-to-wiki\wiki-config.json" 'https://wiki.example.com'
  [IO.File]::WriteAllText((PathOf "$c\database-query\references\schema.md"), "# my schema`n")
  Set-Profile "$c\workflow\profile.json" 'develop'
  [IO.File]::WriteAllText((PathOf "$c\dev\SKILL.md"), "stale`n")   # 手改过的模板文件：保留，新模板另存为 .new
  foreach ($f in 'database-query\config.json', 'md-to-wiki\wiki-config.json', 'workflow\profile.json') {
    Copy-Item -LiteralPath (PathOf "$c\$f") -Destination (Join-Path $Work ('rerun-' + (Split-Path -Leaf $f)))
  }
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes'); Expect-Rc 0
  Assert-Same "$c\md-to-wiki\wiki-config.json" (Join-Path $Work 'rerun-wiki-config.json')
  Assert-Content "$c\database-query\references\schema.md" '# my schema'
  Assert-Same "$c\workflow\profile.json" (Join-Path $Work 'rerun-profile.json')
  Assert-Same "$c\database-query\config.json" (Join-Path $Work 'rerun-config.json')
  Assert-Content "$c\dev\SKILL.md" 'stale'
  Assert-Same "$c\dev\SKILL.md.new" (Join-Path $Repo 'dev\SKILL.md.tpl')
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Same "$c\database-query\config.json" (Join-Path $Work 'rerun-config.json')
}

function Get-Sha([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Log-Has([string]$text) { (Get-Content -LiteralPath $script:Log -Raw) -like "*$text*" }

function Test-ManifestWritten {
  New-Project 'manifest'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  $m = '.agents\skills\.skills-init.json'
  Assert-File $m
  $j = Get-Json $m
  Assert-Eq $j.version (Get-Content -LiteralPath (Join-Path $Repo 'package.json') -Raw | ConvertFrom-Json).version '清单中的安装器版本'
  Assert-Eq ($j.envs -join ',') 'claude,qwen' '清单中的环境'
  Assert-Eq $j.skills.dev.files.'SKILL.md' (Get-Sha (Join-Path $Repo 'dev\SKILL.md.tpl')) '清单中 dev/SKILL.md 的 sha256'
  Assert-Eq $j.skills.'project-review'.files.'references/checklist.md' (Get-Sha (Join-Path $Repo 'project-review\references\checklist.md.tpl')) '清单中 checklist.md 的 sha256'
  # 用户配置只记存在与否，不记哈希
  Assert-Eq $j.skills.workflow.userFiles.'profile.json' 'True' '清单中 profile.json 的存在标记'
  Assert-Eq $j.skills.'database-query'.userFiles.'config.json' 'False' '清单中 config.json 的存在标记'
  if ($j.skills.workflow.files.PSObject.Properties.Name -contains 'profile.json') { Fail 'profile.json 不应记录哈希' }
  Assert-Missing '.claude\skills\.skills-init.json'
  # -Copy：每个目标目录各一份
  New-Project 'manifest-copy'
  Invoke-Install @('-Envs', 'claude,qwen', '-Copy', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-File '.claude\skills\.skills-init.json'
  Assert-File '.qwen\skills\.skills-init.json'
  Assert-Eq (Get-Json '.qwen\skills\.skills-init.json').mode 'copy' '-Copy 清单中的 mode'
}

function Test-ModifiedTemplateKeptAsNew {
  New-Project 'modified'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  $c = '.agents\skills'
  $tpl = Join-Path $Repo 'dev\SKILL.md.tpl'
  [IO.File]::WriteAllText((PathOf "$c\dev\SKILL.md"), "my edits`n")
  # -Yes：保留用户版本，新模板写成 SKILL.md.new，结尾汇总提示
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Content "$c\dev\SKILL.md" 'my edits'
  Assert-Same "$c\dev\SKILL.md.new" $tpl
  if (-not (Log-Has '.agents/skills/dev/SKILL.md  ->  SKILL.md.new')) { Fail '日志中缺少 .new 汇总提示' }
  # 交互选 k：保留用户版本、清理上次的 .new
  Invoke-Install @('-Envs', 'claude,qwen', '-SkipDb') "k`n"; Expect-Rc 0
  Assert-Content "$c\dev\SKILL.md" 'my edits'
  Assert-Missing "$c\dev\SKILL.md.new"
  # 交互选 o：用新模板覆盖
  Invoke-Install @('-Envs', 'claude,qwen', '-SkipDb') "o`n"; Expect-Rc 0
  Assert-Same "$c\dev\SKILL.md" $tpl
  Assert-Missing "$c\dev\SKILL.md.new"
}

function Test-RemovedTemplateFilesPruned {
  New-Project 'prune'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  $c = '.agents\skills'
  Add-Content -LiteralPath (PathOf "$c\dev\references\delivery-template.md") -Value 'my notes'
  Copy-Item -LiteralPath (PathOf "$c\dev\references\delivery-template.md") -Destination (Join-Path $Work 'prune-delivery.md')
  # 新版本模板删掉文件：未改过的被清理，改过的保留并提示
  Remove-Item -LiteralPath (PathOf 'skills-init\dev\references\plan-template.md'), (PathOf 'skills-init\dev\references\delivery-template.md')
  Remove-Item -LiteralPath (PathOf 'skills-init\create-tech-md-doc\references') -Recurse -Force
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Missing "$c\dev\references\plan-template.md"
  Assert-Same "$c\dev\references\delivery-template.md" (Join-Path $Work 'prune-delivery.md')
  Assert-Missing "$c\create-tech-md-doc\references"
  Assert-File "$c\create-tech-md-doc\SKILL.md"
  if (-not (Log-Has '.agents/skills/dev/references/delivery-template.md')) { Fail '日志中缺少保留过时文件的提示' }
}

function Test-Uninstall {
  New-Project 'uninstall'
  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  $c = '.agents\skills'
  Set-Wiki "$c\md-to-wiki\wiki-config.json" 'https://wiki.example.com'
  Set-Profile "$c\workflow\profile.json" 'develop'
  [IO.File]::WriteAllText((PathOf "$c\project-review\SKILL.md"), "my edits`n")
  Copy-Item -LiteralPath (PathOf "$c\md-to-wiki\wiki-config.json") -Destination (Join-Path $Work 'uninstall-wiki.json')
  Copy-Item -LiteralPath (PathOf "$c\workflow\profile.json") -Destination (Join-Path $Work 'uninstall-profile.json')
  # 用户自己的 skill / 文件：都不动
  New-Item -ItemType Directory -Force -Path (PathOf "$c\my-skill"), (PathOf '.claude\skills\my-claude-skill') | Out-Null
  [IO.File]::WriteAllText((PathOf "$c\my-skill\SKILL.md"), "mine`n")
  [IO.File]::WriteAllText((PathOf '.claude\skills\my-claude-skill\SKILL.md'), "mine`n")
  [IO.File]::WriteAllText((PathOf "$c\dev\notes.md"), "notes`n")

  Invoke-Install @('-Uninstall'); Expect-Rc 0
  foreach ($s in $Skills) {
    Assert-Missing ".claude\skills\$s"
    Assert-Missing ".qwen\skills\$s"
    if ($s -ne 'dev') { Assert-Missing "$c\$s" }
  }
  Assert-Missing "$c\.skills-init.json"
  Assert-Missing "$c\dev\SKILL.md"
  Assert-Content "$c\dev\notes.md" 'notes'
  Assert-Content "$c\my-skill\SKILL.md" 'mine'
  Assert-Content '.claude\skills\my-claude-skill\SKILL.md' 'mine'
  # 用户配置与手改过的模板文件备份到 tmp\skills\uninstall-backup\<时间戳>\
  $b = @(Get-ChildItem -LiteralPath (PathOf 'tmp\skills\uninstall-backup') -Directory -ErrorAction SilentlyContinue)
  if ($b.Count -ne 1) { Fail "uninstall-backup 下的目录数 $($b.Count)，期望 1"; return }
  $bak = Join-Path 'tmp\skills\uninstall-backup' $b[0].Name
  Assert-Same "$bak\$c\md-to-wiki\wiki-config.json" (Join-Path $Work 'uninstall-wiki.json')
  Assert-Same "$bak\$c\workflow\profile.json" (Join-Path $Work 'uninstall-profile.json')
  Assert-Content "$bak\$c\project-review\SKILL.md" 'my edits'
  # 再卸载一次：没有清单，什么也不做
  Invoke-Install @('-Uninstall'); Expect-Rc 0
  Assert-Content "$c\my-skill\SKILL.md" 'mine'
}

function Test-UninstallCopyMode {
  New-Project 'uninstall-copy'
  Invoke-Install @('-Envs', 'claude,qwen', '-Copy', '-Yes', '-SkipDb'); Expect-Rc 0
  Invoke-Install @('-Uninstall'); Expect-Rc 0
  foreach ($d in '.claude', '.qwen', '.agents') { Assert-Missing $d }
}

function Test-UpgradeFromCopies {
  New-Project 'upgrade'
  if (-not (New-OldLayout @('-Envs', 'all', '-Yes', '-SkipDb'))) { return }
  Assert-Dir '.claude\skills\dev'; Assert-File '.claude\skills\dev\profile.json'; Assert-Missing '.claude\skills\workflow'
  # 用户只在 claude / qwen 的拷贝里填写过配置，.agents 里仍是空模板
  Set-Wiki '.claude\skills\md-to-wiki\wiki-config.json' 'https://wiki.example.com'
  Set-Profile '.claude\skills\dev\profile.json' 'main'
  New-Item -ItemType Directory -Force -Path (PathOf '.qwen\skills\database-query\references') | Out-Null
  [IO.File]::WriteAllText((PathOf '.qwen\skills\database-query\config.json'), '{"connections":{"default":{"host":"db.local","database":"x"}}}' + "`n")
  [IO.File]::WriteAllText((PathOf '.qwen\skills\database-query\references\schema.md'), "# qwen schema`n")
  Copy-Item -LiteralPath (PathOf '.claude\skills\md-to-wiki\wiki-config.json') -Destination (Join-Path $Work 'upgrade-wiki.json')
  Copy-Item -LiteralPath (PathOf '.claude\skills\dev\profile.json') -Destination (Join-Path $Work 'upgrade-profile.json')
  Copy-Item -LiteralPath (PathOf '.qwen\skills\database-query\config.json') -Destination (Join-Path $Work 'upgrade-config.json')

  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  if (-not $SymlinkOk) { Write-Host '    (软链接不可用，跳过迁移断言)'; return }
  Assert-EnvLinked '.claude\skills'
  Assert-EnvLinked '.qwen\skills'
  $c = '.agents\skills'
  Assert-Same "$c\md-to-wiki\wiki-config.json" (Join-Path $Work 'upgrade-wiki.json')
  Assert-Same "$c\workflow\profile.json" (Join-Path $Work 'upgrade-profile.json')
  Assert-Missing "$c\dev\profile.json"
  Assert-Same "$c\database-query\config.json" (Join-Path $Work 'upgrade-config.json')
  Assert-Content "$c\database-query\references\schema.md" '# qwen schema'
  $backups = @(Get-ChildItem -LiteralPath (PathOf 'tmp\skills\backup') -Directory -ErrorAction SilentlyContinue)
  $wikiBak = @($backups | ForEach-Object { Join-Path $_.FullName 'claude\md-to-wiki\wiki-config.json' } | Where-Object { Test-Path -LiteralPath $_ })
  if ($wikiBak.Count -ne 1) { Fail "claude 的 md-to-wiki 备份数量 $($wikiBak.Count)，期望 1" }
  elseif ((Get-FileHash -LiteralPath $wikiBak[0]).Hash -ne (Get-FileHash -LiteralPath (Join-Path $Work 'upgrade-wiki.json')).Hash) { Fail '备份的 wiki-config.json 内容不符' }
  foreach ($e in 'claude', 'qwen') {
    foreach ($s in 'dev', 'database-query', 'md-to-wiki', 'create-tech-md-doc', 'create-release-md-doc') {
      $n = @($backups | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "$e\$s") }).Count
      Assert-Eq $n 1 "$e\$s 的备份数量"
    }
  }
  # code-review 已改名为 project-review：旧名的目录 / 链接全部清理，不留备份
  foreach ($e in '.agents', '.claude', '.qwen') { Assert-Missing "$e\skills\code-review" }
}

function Test-UpgradeConflictKeepsOldDir {
  New-Project 'conflict'
  if (-not (New-OldLayout @('-Envs', 'all', '-Yes', '-SkipDb'))) { return }
  if (-not $SymlinkOk) { Write-Host '    (软链接不可用，跳过)'; return }
  Set-Wiki '.agents\skills\md-to-wiki\wiki-config.json' 'https://a.example.com'
  Set-Wiki '.claude\skills\md-to-wiki\wiki-config.json' 'https://b.example.com'
  Copy-Item -LiteralPath (PathOf '.agents\skills\md-to-wiki\wiki-config.json') -Destination (Join-Path $Work 'conflict-a.json')
  Copy-Item -LiteralPath (PathOf '.claude\skills\md-to-wiki\wiki-config.json') -Destination (Join-Path $Work 'conflict-b.json')

  Invoke-Install @('-Envs', 'claude,qwen', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Dir '.claude\skills\md-to-wiki'
  Assert-Same '.claude\skills\md-to-wiki\wiki-config.json' (Join-Path $Work 'conflict-b.json')
  Assert-Same '.agents\skills\md-to-wiki\wiki-config.json' (Join-Path $Work 'conflict-a.json')
  foreach ($s in 'workflow', 'dev', 'project-review', 'database-query', 'create-tech-md-doc', 'create-release-md-doc') {
    Assert-Link ".claude\skills\$s" "..\..\.agents\skills\$s"
  }
  # qwen 的拷贝没填写过 wiki，不算冲突
  Assert-EnvLinked '.qwen\skills'
}

function Test-GitIgnoreAppendsOnlyMissing {
  New-Project 'gitignore'
  [IO.File]::WriteAllText((PathOf '.gitignore'), "node_modules/`n**/wiki-config.json`n.env`n")
  Invoke-Install @('-Envs', 'claude', '-Yes', '-SkipDb'); Expect-Rc 0
  $lines = [IO.File]::ReadAllLines((PathOf '.gitignore'))
  foreach ($r in '**/database-query/config.json', '**/wiki-config.json', '/tmp/', 'node_modules/', '.env') {
    Assert-Eq @($lines | Where-Object { $_ -ceq $r }).Count 1 ".gitignore 中 $r 的行数"
  }
  Copy-Item -LiteralPath (PathOf '.gitignore') -Destination (Join-Path $Work 'gitignore.after')
  Invoke-Install @('-Envs', 'claude', '-Yes', '-SkipDb'); Expect-Rc 0
  Assert-Same '.gitignore' (Join-Path $Work 'gitignore.after')
}

# =====================================================================
Write-Host ("pwsh {0} on {1}；软链接可用：{2}" -f $PSVersionTable.PSVersion, [Environment]::OSVersion.VersionString, $SymlinkOk)
$tests = @(
  'Test-FreshInstallLinks', 'Test-NoSymlinkFallsBackToCopy', 'Test-NoSymlinkUpgradeKeepsOldCopies', 'Test-CopyMode',
  'Test-YesWithoutDbConfigFails', 'Test-InteractivePasswordEscaping', 'Test-RerunPreservesUserFiles',
  'Test-ManifestWritten', 'Test-ModifiedTemplateKeptAsNew', 'Test-RemovedTemplateFilesPruned', 'Test-Uninstall', 'Test-UninstallCopyMode',
  'Test-UpgradeFromCopies', 'Test-UpgradeConflictKeepsOldDir', 'Test-GitIgnoreAppendsOnlyMissing'
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
