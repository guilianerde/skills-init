# =====================================================================
# init-skills.ps1 — 项目级 Agent Skills 一键初始化（dev / code-review / database-query / 文档类）
#
# 支持环境：codex / claude-code / doubao / qwen
#   安装路径（均为项目级，团队共享）：
#     codex  -> .agents/skills    （Codex 项目级 skills，与豆包共用目录）
#     claude -> .claude/skills
#     doubao -> .agents/skills
#     qwen   -> .qwen/skills
#
# 用法（脚本固定位于 <项目根>\skills-init\ 下，模板随脚本同目录）：
#   .\skills-init\init-skills.ps1                                  # 交互式：选择环境、配置数据库
#   .\skills-init\init-skills.ps1 -Envs codex,claude,doubao,qwen   # 指定环境（仍会交互确认数据库）
#   .\skills-init\init-skills.ps1 -Envs all -Yes -SkipDb           # 全环境、非交互、跳过数据库
#   .\skills-init\init-skills.ps1 -Envs claude,qwen -WithDocNexus  # 同时接入 DocNexus 文档库（需 Node >= 22.13）
#
# 模板目录：skills-init\（database-query / code-review 两个 skill 的 .tpl 源文件）
#
# 重跑安全：SKILL.md / references 模板会更新；用户已填写的 wiki-config.json、
#           schema.md、workflow/profile.json 保留不覆盖；database-query/config.json 仅在本次提供了数据库配置时写入。
#
# 单一来源：skills 只完整安装到 .agents\skills（codex / doubao 直接使用）；
#           .claude\skills、.qwen\skills 下按 skill 建相对软链接指向它。
#           Windows 建软链接需开启「开发者模式」或管理员权限；建不了时该环境自动退回独立拷贝。
#           -Copy 直接使用各环境独立拷贝。
# =====================================================================

param(
  [string]$Envs = "",          # 逗号分隔环境：codex,claude,doubao,qwen 或 all
  [switch]$SkipDb,             # 跳过数据库连接配置（database-query 不生成 config.json）
  [switch]$Yes,                # 非交互模式：使用检测到的现有数据库配置；无配置且未 SkipDb 时报错退出
  [switch]$WithDocNexus,       # 安装 @rowansenne/docnexus 并执行 docnexus init（需 Node >= 22.13）
  [switch]$Copy                # 不用软链接，每个环境各拷一份
)

$ErrorActionPreference = 'Stop'
# 脚本固定位于 <项目根>\skills-init\ 下：项目根 = 脚本目录的上一级
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root       = Split-Path -Parent $ScriptDir
$TplDir     = $ScriptDir
$envNames   = @('codex','claude','doubao','qwen')
$CanonDir   = '.agents\skills'   # 单一来源目录
$SkillNames = @('workflow','dev','code-review','database-query','md-to-wiki','create-tech-md-doc','create-release-md-doc')
# 各 skill 内的用户配置（相对 skill 目录），迁移旧的独立拷贝时需要保留；值为对应空模板（无则为 $null）
$UserFiles  = [ordered]@{
  'database-query\config.json'          = $null
  'database-query\references\schema.md' = $null
  'md-to-wiki\wiki-config.json'         = 'md-to-wiki\wiki-config.json.tpl'
  'workflow\profile.json'               = 'workflow\profile.json.tpl'
}
# DocNexus 安装来源：默认 npm 包；可用环境变量 DOCNEXUS_PKG 指向本地 tarball / 目录（离线或测试用）
$DocNexusPkg = if ($env:DOCNEXUS_PKG) { $env:DOCNEXUS_PKG } else { '@rowansenne/docnexus' }

# ---------------------------------------------------------------- helpers
function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    !!  $msg" -ForegroundColor Yellow }

function Read-Choice([string]$prompt, [string]$default) {
  $v = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($v)) { return $default }
  return $v.Trim()
}

function Render-Template([string]$relTpl, [string]$relDest, [hashtable]$map) {
  $tpl  = Join-Path $TplDir $relTpl
  # relDest 可能是绝对路径（如用户级 ~/.codex/skills），此时不再拼接项目根
  $dest = if ([IO.Path]::IsPathRooted($relDest)) { $relDest } else { Join-Path $Root $relDest }
  if (-not (Test-Path -LiteralPath $tpl)) { throw "模板不存在: $tpl" }
  $dir = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $content = [IO.File]::ReadAllText($tpl)
  foreach ($k in $map.Keys) { $content = $content.Replace('{{' + $k + '}}', [string]$map[$k]) }
  # UTF-8 无 BOM：各平台 agent 解析最稳
  [IO.File]::WriteAllText($dest, $content, (New-Object System.Text.UTF8Encoding $false))
  Write-Ok $relDest
}

# ------------------------------------------------- 1. 环境选择
function Resolve-EnvSelection {
  if ($Envs) {
    if ($Envs.Trim().ToLower() -eq 'all') { return $envNames }
    return $Envs -split ',' | ForEach-Object { $_.Trim().ToLower() } |
           Where-Object { $_ -in $envNames } | Select-Object -Unique
  }
  Write-Step '选择要安装 skills 的环境'
  Write-Host '  1) codex     -> .agents/skills （Codex 项目级，与豆包共用）'
  Write-Host '  2) claude    -> .claude/skills （Claude Code 项目级）'
  Write-Host '  3) doubao    -> .agents/skills （豆包办公项目级）'
  Write-Host '  4) qwen      -> .qwen/skills   （Qwen Code 项目级）'
  $choice = Read-Host '输入编号（逗号分隔，如 1,3；直接回车 = 全部）'
  if ([string]::IsNullOrWhiteSpace($choice)) { return $envNames }
  $sel = @()
  foreach ($part in ($choice -split '[,\s，]+')) {
    $n = 0
    if ([int]::TryParse($part, [ref]$n) -and $n -ge 1 -and $n -le 4) { $sel += $envNames[$n - 1] }
  }
  if ($sel.Count -eq 0) { Write-Warn '未识别到有效编号，按全部安装'; return $envNames }
  return $sel | Select-Object -Unique
}

# ------------------------------------------------- 2. 数据库连接配置
function Find-ExistingDbConfig {
  # 已有数据库配置来源：旧版 .codex 目录 + 已安装的各环境目录（重跑 -Yes 时可复用）
  foreach ($rel in @('.codex\database-query\config.json', '.agents\skills\database-query\config.json',
                     '.claude\skills\database-query\config.json', '.qwen\skills\database-query\config.json')) {
    $p = Join-Path $Root $rel
    if (Test-Path -LiteralPath $p) {
      try { if ((Get-Content -LiteralPath $p -Raw | ConvertFrom-Json).connections.default.host) { return $p } } catch { }
    }
  }
  return $null
}

function Get-DbConfig {
  # 返回 hashtable（driver/host/port/database/user/password）或 $null（跳过）
  $legacy = Find-ExistingDbConfig
  if ($legacy) {
    try {
      $cfg = Get-Content -LiteralPath $legacy -Raw | ConvertFrom-Json
      $c = $cfg.connections.default
      if ($c -and $c.host -and $c.database) {
        $masked = if ($c.password) { ('*' * [Math]::Min(8, $c.password.Length)) } else { '(空)' }
        Write-Step '数据库连接配置'
        Write-Host ("    检测到现有配置: {0}" -f $legacy)
        Write-Host ("    driver={0}  host={1}:{2}  db={3}  user={4}  password={5}" -f $c.driver, $c.host, $c.port, $c.database, $c.user, $masked)
        if ($Yes) {
          Write-Ok '非交互模式，使用现有配置'
          return @{ driver = if ($c.driver) { $c.driver } else { 'mysql' }; host = $c.host; port = $c.port; database = $c.database; user = $c.user; password = if ($c.password) { $c.password } else { '' } }
        }
        $a = Read-Choice '使用此配置？[Y=使用 / n=重新填写 / s=跳过数据库]' 'y'
        if ($a -eq 's' -or $a -eq 'S' -or $a -eq 'skip') { return $null }
        if ($a -ne 'n' -and $a -ne 'N') {
          return @{ driver = if ($c.driver) { $c.driver } else { 'mysql' }; host = $c.host; port = $c.port; database = $c.database; user = $c.user; password = if ($c.password) { $c.password } else { '' } }
        }
        # 落 n → 重新填写
      }
    } catch { Write-Warn ("读取现有配置失败（{0}），请手动填写" -f $_.Exception.Message) }
  } elseif ($Yes -and -not $SkipDb) {
    throw "非交互模式（-Yes）但未找到已有数据库配置（.codex\ 或各环境 database-query\config.json），无法自动获取数据库凭据。请去掉 -Yes 手动输入，或加 -SkipDb。"
  }
  if ($SkipDb) { return $null }
  if (-not $Yes) {
    Write-Step '填写数据库连接（将写入各环境 database-query/config.json，并加入 .gitignore）'
    $driver   = Read-Choice '数据库驱动 [mysql]' 'mysql'
    $dbHost   = Read-Host '数据库主机'
    $portStr  = Read-Host '端口'
    $port     = 0
    if (-not [int]::TryParse($portStr, [ref]$port)) { $port = if ($driver -eq 'postgresql') { 5432 } else { 3306 } }
    $database = Read-Host '数据库名'
    $user     = Read-Host '用户名'
    $password = Read-Host '密码'
    if ([string]::IsNullOrWhiteSpace($dbHost) -or [string]::IsNullOrWhiteSpace($database) -or [string]::IsNullOrWhiteSpace($user)) {
      Write-Warn '主机/库名/用户不能为空，跳过数据库配置'
      return $null
    }
    return @{ driver = $driver; host = $dbHost; port = $port; database = $database; user = $user; password = $password }
  }
  return $null
}

# ------------------------------------------------- 3. 安装
function Copy-TplFile([string]$relTpl, [string]$relDest) {
  # 无占位符的纯拷贝（template.md / md_to_wiki.py 等），保持原内容与编码
  $src  = Join-Path $TplDir $relTpl
  $dest = if ([IO.Path]::IsPathRooted($relDest)) { $relDest } else { Join-Path $Root $relDest }
  if (-not (Test-Path -LiteralPath $src)) { throw "模板不存在: $src" }
  $dir = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dest -Force
  Write-Ok $relDest
}

function Install-Skills([string]$targetBase, $dbConfig) {
  # ---- code-review
  Render-Template 'code-review\SKILL.md.tpl'                 "$targetBase\code-review\SKILL.md" @{}
  Render-Template 'code-review\references\checklist.md.tpl'  "$targetBase\code-review\references\checklist.md" @{}
  # ---- database-query
  Render-Template 'database-query\SKILL.md.tpl'              "$targetBase\database-query\SKILL.md" @{}
  if ($dbConfig) {
    # 写进 JSON 字符串的值先做 JSON 转义（密码含 " 或 \ 时不破坏 config.json）；port 为数字原样
    $jsonMap = @{}
    foreach ($k in $dbConfig.Keys) {
      $v = [string]$dbConfig[$k]
      $jsonMap[$k] = if ($k -eq 'port') { $v } else { (ConvertTo-Json $v -Compress).Trim('"') }
    }
    Render-Template 'database-query\config.json.tpl'         "$targetBase\database-query\config.json" $jsonMap
    if (Test-Path -LiteralPath "$targetBase\database-query\references\schema.md") {
      Write-Ok "$targetBase\database-query\references\schema.md 已存在，保留不覆盖"
    } else {
      Render-Template 'database-query\references\schema.md.tpl' "$targetBase\database-query\references\schema.md" @{
        database = $dbConfig.database; host = $dbConfig.host; port = $dbConfig.port; driver = $dbConfig.driver
      }
    }
  } elseif (Test-Path -LiteralPath "$targetBase\database-query\config.json") {
    Write-Ok "$targetBase\database-query\config.json 已存在，保留不覆盖"
  } else {
    Write-Warn "$targetBase\database-query\ 未生成 config.json（未配置数据库）"
  }
  # ---- md-to-wiki（wiki 发布；连接配置默认留空 enabled=false，未配置前 skill 不启动）
  Render-Template 'md-to-wiki\SKILL.md.tpl'                  "$targetBase\md-to-wiki\SKILL.md" @{}
  if (Test-Path -LiteralPath "$targetBase\md-to-wiki\wiki-config.json") {
    Write-Ok "$targetBase\md-to-wiki\wiki-config.json 已存在，保留不覆盖"
  } else {
    Render-Template 'md-to-wiki\wiki-config.json.tpl'        "$targetBase\md-to-wiki\wiki-config.json" @{}
  }
  Copy-TplFile 'md-to-wiki\scripts\md_to_wiki.py'            "$targetBase\md-to-wiki\scripts\md_to_wiki.py"
  # ---- create-tech-md-doc / create-release-md-doc（生成 md；--prd 依赖 wiki 配置，未配置自动回退）
  Render-Template 'create-tech-md-doc\SKILL.md.tpl'          "$targetBase\create-tech-md-doc\SKILL.md" @{}
  Copy-TplFile 'create-tech-md-doc\template.md'              "$targetBase\create-tech-md-doc\template.md"
  Render-Template 'create-release-md-doc\SKILL.md.tpl'       "$targetBase\create-release-md-doc\SKILL.md" @{}
  Copy-TplFile 'create-release-md-doc\template.md'           "$targetBase\create-release-md-doc\template.md"
  # ---- dev（开发 / 修 bug 编排）
  Render-Template 'dev\SKILL.md.tpl'                         "$targetBase\dev\SKILL.md" @{}
  Copy-TplFile 'dev\references\plan-template.md'             "$targetBase\dev\references\plan-template.md"
  # ---- workflow（入口路由 + 共用项目画像 profile.json：无凭据，可提交，重跑不覆盖）
  Render-Template 'workflow\SKILL.md.tpl'                    "$targetBase\workflow\SKILL.md" @{}
  $wfProfile  = "$targetBase\workflow\profile.json"
  $oldProfile = "$targetBase\dev\profile.json"
  if (Test-Path -LiteralPath $wfProfile) {
    Write-Ok "$wfProfile 已存在，保留不覆盖"
  } elseif (Test-Path -LiteralPath $oldProfile) {
    # 旧版本画像放在 dev\ 下：字段兼容，原样迁移（新增字段缺失时视为空）
    Move-Item -LiteralPath $oldProfile -Destination $wfProfile
    Write-Ok "已把旧的 dev\profile.json 迁移为 $wfProfile"
  } else {
    Copy-TplFile 'workflow\profile.json.tpl'                  $wfProfile
  }
}

# ------------------------------------------------- 3b. 软链接到单一来源
function Test-SameFile([string]$a, [string]$b) {
  return (Get-FileHash -LiteralPath $a).Hash -eq (Get-FileHash -LiteralPath $b).Hash
}

function Merge-OldCopy([string]$old, [string]$skill) {
  # 把旧的独立拷贝里的用户配置并入单一来源；冲突返回 $false
  foreach ($rel in $UserFiles.Keys) {
    if (-not $rel.StartsWith("$skill\")) { continue }
    $src = Join-Path $old $rel.Substring($skill.Length + 1)
    $dst = Join-Path (Join-Path $Root $CanonDir) $rel
    if (-not (Test-Path -LiteralPath $src)) { continue }
    if ((Test-Path -LiteralPath $dst) -and -not (Test-SameFile $src $dst)) {
      $tpl = $UserFiles[$rel]
      if (-not $tpl -or -not (Test-SameFile $dst (Join-Path $TplDir $tpl))) {
        Write-Warn "$old 与 $CanonDir\$skill 的 $($rel.Substring($skill.Length + 1)) 内容不同，无法自动合并：保留旧目录、未建链接。请手动合并后删除旧目录再重跑。"
        return $false
      }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  # 旧版本画像在 dev\profile.json：单一来源里的 workflow\profile.json 还是空模板时迁移过去
  $oldProfile = Join-Path $old 'profile.json'
  # 旧画像里没有任何非空字符串值 = 未填写过的空模板，直接忽略
  $oldFilled = $false
  if ($skill -eq 'dev' -and (Test-Path -LiteralPath $oldProfile)) {
    try {
      $p = Get-Content -LiteralPath $oldProfile -Raw | ConvertFrom-Json
      $oldFilled = @($p.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value -ne '' }).Count -gt 0
    } catch { $oldFilled = $true }
  }
  if ($oldFilled) {
    $dst = Join-Path (Join-Path $Root $CanonDir) 'workflow\profile.json'
    if (-not (Test-Path -LiteralPath $dst) -or (Test-SameFile $dst (Join-Path $TplDir 'workflow\profile.json.tpl'))) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
      Copy-Item -LiteralPath $oldProfile -Destination $dst -Force
    } elseif (-not (Test-SameFile $oldProfile $dst)) {
      Write-Warn "$oldProfile 与 $CanonDir\workflow\profile.json 都填写过且内容不同：未迁移，旧文件会随目录备份，请手动合并。"
    }
  }
  return $true
}

function New-RelLink([string]$link, [string]$target) {
  # 相对目录软链接：PowerShell 7 用 .NET API（保留相对路径），否则用 mklink /D
  try {
    if ([IO.Directory] | Get-Member -Static -Name CreateSymbolicLink) {
      [IO.Directory]::CreateSymbolicLink($link, $target) | Out-Null
    } else {
      cmd /c mklink /D "`"$link`"" "`"$target`"" 2>&1 | Out-Null
    }
  } catch { }
  return (Test-Path -LiteralPath $link)
}

function Link-Skills([string]$envName, [string]$rel, $dbConfig) {
  # 返回 $true 表示全部建链成功；建链不被系统允许时退回独立拷贝
  $dir = Join-Path $Root $rel
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $skipped = 0
  foreach ($skill in $SkillNames) {
    $link   = Join-Path $dir $skill
    $target = "..\..\$CanonDir\$skill"
    $item   = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'SymbolicLink') {
      if ([string]$item.Target -eq $target) { continue }
      $item.Delete()
    } elseif ($item -and $item.PSIsContainer) {
      if (-not (Merge-OldCopy $link $skill)) { $skipped++; continue }
      $bak = Join-Path $Root ("tmp\skills\backup\{0}\{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $envName)
      New-Item -ItemType Directory -Force -Path $bak | Out-Null
      Move-Item -LiteralPath $link -Destination (Join-Path $bak $skill)
      Write-Ok "$rel\$skill 旧的独立拷贝已并入单一来源，原目录备份到 $bak\$skill"
    } elseif ($item) {
      Write-Warn "$link 已存在且不是目录或软链接，跳过"; $skipped++; continue
    }
    if (-not (New-RelLink $link $target)) {
      Write-Warn "$envName：系统不允许创建软链接（需开启开发者模式或以管理员运行），改为独立拷贝到 $dir"
      Install-Skills $dir $dbConfig
      return $false
    }
  }
  if ($skipped -eq 0) { Write-Ok "$envName -> $rel（软链接到 $CanonDir）" }
  else { Write-Warn "$envName -> $rel：$skipped 个 skill 未建链接（见上方提示），其余已软链接到 $CanonDir" }
  return $true
}

# ------------------------------------------------- 4. .gitignore 保护
function Update-GitIgnore {
  # 凭据（database-query / wiki）+ 技能临时产物目录
  $rules = @('**/database-query/config.json', '**/wiki-config.json', '/tmp/')
  if ($WithDocNexus) { $rules += 'node_modules/' }
  $gi    = Join-Path $Root '.gitignore'
  if (Test-Path -LiteralPath $gi) {
    $lines   = @([IO.File]::ReadAllLines($gi) | ForEach-Object { $_.Trim() })
    $missing = @($rules | Where-Object { $_ -notin $lines })
    if ($missing.Count -eq 0) { Write-Ok '.gitignore 已包含全部规则'; return }
    $add = "`n# Agent skills generated rules (credentials + tmp artifacts; do not commit)`n" + ($missing -join "`n") + "`n"
    [IO.File]::AppendAllText($gi, $add, (New-Object System.Text.UTF8Encoding $false))
    Write-Ok ".gitignore 已追加：$($missing -join ', ')"
  } else {
    [IO.File]::WriteAllText($gi, "# Agent skills generated rules (credentials + tmp artifacts; do not commit)`n" + ($rules -join "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
    Write-Ok '.gitignore 已创建并写入规则'
  }
}

# ------------------------------------------------- 5. DocNexus 文档库（可选，-WithDocNexus）
function Test-NodeVersion {
  # Node >= 22.13；不满足直接报错退出（尚未安装任何文件）
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw '-WithDocNexus 需要 Node >= 22.13 与 npm，但未找到 node/npm。请安装后重试，或去掉 -WithDocNexus。'
  }
  $raw = (& node -v).Trim()
  $ver = $null
  if (-not [version]::TryParse($raw.TrimStart('v'), [ref]$ver) -or $ver -lt [version]'22.13.0') {
    throw ("-WithDocNexus 需要 Node >= 22.13，当前为 {0}。请升级 Node 后重试，或去掉 -WithDocNexus。" -f $raw)
  }
  Write-Ok "Node $raw"
}

function Get-DocNexusAgent($selected) {
  # 所选环境 -> docnexus init --agent 取值（doubao 与 codex 共用 .agents；qwen 不受 docnexus 支持）
  $c = 'claude' -in $selected
  $x = ('codex' -in $selected) -or ('doubao' -in $selected)
  if ($c -and $x) { return 'all' }
  if ($c) { return 'claude' }
  if ($x) { return 'codex' }
  return 'none'
}

function Link-QwenDocNexus {
  # docnexus 不支持 qwen：把 docnexus\skills\* 链接到 .qwen\skills\（Windows 用 junction，与 docnexus 一致）
  $srcRoot = Join-Path $Root 'docnexus\skills'
  $dst     = Join-Path $Root '.qwen\skills'
  if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Force -Path $dst | Out-Null }
  $n = 0
  foreach ($d in (Get-ChildItem -LiteralPath $srcRoot -Directory)) {
    $link = Join-Path $dst $d.Name
    $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($item -and -not $item.LinkType) {
      Write-Warn "$link 已存在且不是链接，跳过（如需改用 DocNexus 版本请先移除）"; continue
    }
    if ($item) { $item.Delete() }   # 只删除链接本身，不动目标目录
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
      New-Item -ItemType Junction -Path $link -Target $d.FullName | Out-Null
    } else {
      New-Item -ItemType SymbolicLink -Path $link -Target "../../docnexus/skills/$($d.Name)" | Out-Null
    }
    $n++
  }
  Write-Ok "qwen：已链接 $n 个 DocNexus skill -> .qwen\skills（docnexus 本身不支持 qwen，由本脚本补链）"
}

function Install-DocNexus($selected) {
  # 返回 'ok' / 'failed'；失败不影响已安装的 skills
  $agent = Get-DocNexusAgent $selected
  Write-Step "接入 DocNexus（npm i -D $DocNexusPkg；docnexus init --agent $agent）"
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
    Write-Warn '项目根没有 package.json，npm 会新建一个（仅记录 devDependency）'
  }
  Push-Location $Root
  try {
    & npm i -D $DocNexusPkg | Out-Host   # 输出直接显示，不混入函数返回值
    if ($LASTEXITCODE -ne 0) { Write-Warn 'npm 安装 DocNexus 失败，已跳过 DocNexus 接入（skills 已正常安装）'; return 'failed' }
    $bin = @('node_modules\.bin\docnexus.cmd', 'node_modules/.bin/docnexus') |
           ForEach-Object { Join-Path $Root $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $bin) { Write-Warn '未找到 node_modules\.bin\docnexus，已跳过 DocNexus 接入'; return 'failed' }
    & $bin init --agent $agent | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "docnexus init 失败，已跳过 DocNexus 接入（可在项目根手动执行 .\node_modules\.bin\docnexus init --agent $agent）"
      return 'failed'
    }
  } finally { Pop-Location }
  Write-Ok 'docnexus init 完成：docnexus\ 工作区 + skills（docnexus\skills）'
  switch ($agent) {
    'all'    { Write-Ok '已链接到 .claude\skills 与 .agents\skills，并写入 CLAUDE.md / AGENTS.md 的 DocNexus 段落' }
    'claude' { Write-Ok '已链接到 .claude\skills，并写入 CLAUDE.md 的 DocNexus 段落' }
    'codex'  { Write-Ok '已链接到 .agents\skills，并写入 AGENTS.md 的 DocNexus 段落' }
  }
  if ('doubao' -in $selected) { Write-Ok 'doubao 与 codex 共用 .agents\skills，按 codex 接入' }
  if ('qwen' -in $selected) {
    Link-QwenDocNexus
    if ($agent -eq 'codex' -or $agent -eq 'all') {
      Write-Warn 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可在 QWEN.md 引用 AGENTS.md 中的 DocNexus 段落，或在 .qwen\settings.json 的 context.fileName 加入 AGENTS.md'
    } else {
      Write-Warn 'qwen：docnexus 不会写 QWEN.md；需要自动召回时可执行 .\node_modules\.bin\docnexus init --agent codex 生成 AGENTS.md 的 DocNexus 段落，再在 QWEN.md 引用它或在 .qwen\settings.json 的 context.fileName 加入 AGENTS.md（会同时链接到 .agents\skills）'
    }
  }
  return 'ok'
}

# ================================================================= main
$docNexusResult = 'skipped'
if ($WithDocNexus) { Write-Step '检查 DocNexus 依赖'; Test-NodeVersion }

$sel = Resolve-EnvSelection
Write-Step ("目标环境：{0}" -f ($sel -join ', '))

$dbConfig = $null
if (-not $SkipDb) { $dbConfig = Get-DbConfig }

# 安装目标：单一来源模式下 .agents\skills 只装一次，其余环境建链接；-Copy 时各环境各装一份
$targets = @()
$links   = @()
if ($Copy) {
  if ('codex' -in $sel -or 'doubao' -in $sel) { $targets += @{ Env='codex/doubao'; Dir=$CanonDir } }
  if ('claude' -in $sel) { $targets += @{ Env='claude'; Dir='.claude\skills' } }
  if ('qwen'   -in $sel) { $targets += @{ Env='qwen';   Dir='.qwen\skills'   } }
} else {
  $targets += @{ Env='单一来源'; Dir=$CanonDir }
  if ('claude' -in $sel) { $links += @{ Env='claude'; Dir='.claude\skills' } }
  if ('qwen'   -in $sel) { $links += @{ Env='qwen';   Dir='.qwen\skills'   } }
}

# codex 用户级（可选）
$codexUser = $null
if ('codex' -in $sel -and -not $Yes) {
  $a = Read-Choice '是否同时安装到 Codex 用户级 ~\.codex\skills（所有项目可用）？[y/N]' 'n'
  if ($a -eq 'y' -or $a -eq 'Y') {
    $userHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    $codexUser = Join-Path $userHome '.codex\skills'
    $targets += @{ Env='codex(user)'; Dir=$codexUser }
  }
}

foreach ($t in $targets) {
  $abs = if ([IO.Path]::IsPathRooted($t.Dir)) { $t.Dir } else { Join-Path $Root $t.Dir }
  Write-Step ("安装到 {0}  ->  {1}" -f $t.Env, $abs)
  Install-Skills $abs $dbConfig
}

foreach ($l in $links) {
  Write-Step ("链接 {0}  ->  {1}" -f $l.Env, (Join-Path $Root $l.Dir))
  Link-Skills $l.Env $l.Dir $dbConfig | Out-Null
}

# wiki 凭据与 tmp 产物同样需要忽略：无论是否配置数据库都执行
Update-GitIgnore

if ($WithDocNexus) { $docNexusResult = Install-DocNexus $sel }

# ------------------------------------------------- 汇总
Write-Step '安装完成，启用方式'
$notes = @(
  '  codex     : 重启 codex 后自动发现项目级 skills（.agents/skills）；也可 /use code-review 手动加载',
  '  claude    : Claude Code 自动发现 .claude/skills，无需额外配置',
  '  doubao    : 豆包办公自动发现 .agents/skills（新会话生效）',
  '  qwen      : Qwen Code 自动发现 .qwen/skills；/skills 面板可查看与切换'
)
$notes | ForEach-Object { Write-Host $_ }
if (-not $dbConfig) {
  Write-Warn '注意：本次未写入数据库连接。可重跑本脚本补配，或在各环境 database-query/config.json 手动放置连接配置（已有的保留不动）。'
} else {
  Write-Ok 'database-query 连接已生成并写入各环境；凭据已加入 .gitignore，请勿提交。'
}
Write-Warn '注意：md-to-wiki 的 wiki 连接（wiki-config.json）默认留空（enabled=false），未配置前 md-to-wiki 与 create-*-md-doc 的 --prd 增强不启动。'
Write-Warn '        启用方法：填写各环境 md-to-wiki/wiki-config.json（enabled: true + base_url + api_token），或接入对应环境的 wiki MCP。重跑本脚本不会覆盖已填写的配置。'
switch ($docNexusResult) {
  'ok'     { Write-Ok 'DocNexus 已接入：dev / code-review 会按 docnexus-recall 查项目约定；任何写入 DocNexus 的操作都需你授权。' }
  'failed' { Write-Warn '注意：DocNexus 接入失败（见上方输出），其他 skills 不受影响；修复后可重跑本脚本（加 -WithDocNexus）。' }
}
Write-Host '模板与说明：skills-init\README.md'
# skills 已装好，但显式要求的 DocNexus 未接入：返回非 0 便于自动化感知
if ($docNexusResult -eq 'failed') { exit 1 }
