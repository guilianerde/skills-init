# skills-init — 项目级 Agent Skills 一键初始化

把 **database-query（数据库查询）**、**code-review（代码审查）**、**md-to-wiki（发布文档到**

**Confluence）**、**create-tech-md-doc /create-release-md-doc（从 git diff 生成技术 / 上线方案）**

封装成通用项目级 Skills。在工作目录执行一条命令、选择环境，自动生成到各 AI 编程代理的项目级

技能目录，团队共享（可提交 git）。

支持环境：**Codex CLI / Claude Code / 豆包办公（Doubao）/ 千问（Qwen Code）**。

> 本文件夹自包含：初始化命令 + 模板都在
> `skills-init/`
> 下，脚本会以
> **上级目录**
> 作为项目根，
> 因此从项目任意位置引用均可（调用时保持脚本位于
> `<项目根>/skills-init/`
> 即可）。

## 快速开始



```
# Windows（PowerShell，项目根目录执行）
.\skills-init\init-skills.ps1

# macOS / Linux / Git Bash / WSL
./skills-init/init-skills.sh
```

按提示：选择环境（编号多选，回车 = 全部）→ 确认 / 填写数据库连接 → 自动生成。

非交互示例：



```
.\skills-init\init-skills.ps1 -Envs codex,claude,doubao,qwen -Yes   # 用现有配置，装全部环境
.\skills-init\init-skills.ps1 -Envs all -Yes -SkipDb                 # 跳过数据库，只装 code-review 等
```



```
./skills-init/init-skills.sh --envs all --yes                        # bash 版等价
./skills-init/init-skills.sh --envs codex,qwen --skip-db
```

## 安装路径与启用方式



| 环境          | 生成目录                         | 启用方式                                     |
| ----------- | ---------------------------- | ---------------------------------------- |
| codex       | `.agents/skills/`（项目级，与豆包共用） | 重启 codex 自动发现；也可 `/use code-review` 手动加载 |
| claude-code | `.claude/skills/`            | Claude Code 自动发现，无需额外配置                  |
| doubao      | `.agents/skills/`            | 豆包办公自动发现（新会话生效）                          |
| qwen        | `.qwen/skills/`              | Qwen Code 自动发现；`/skills` 面板可查看与切换        |

> Codex 也可选择额外安装到用户级
> `~/.codex/skills/`
> （所有项目可用），脚本会询问。

每个 skill 目录结构（四环境一致）：



```
<env-dir>/
├── code-review/                      # 代码审查
│   ├── SKILL.md                      # 触发描述 + 审查工作流 + 输出模板
│   └── references/checklist.md       # 10 维度审查清单（含 Nacos 配置维度）
├── database-query/                   # 数据库查询
│   ├── SKILL.md                      # 触发描述 + 查询工作流 + 只读/安全规则
│   ├── config.json                   # 数据库连接（init 生成，已加入 .gitignore）
│   └── references/schema.md          # 表结构速查（初始为空，建议补齐后提交）
├── md-to-wiki/                       # 发布 md 到 Confluence wiki
│   ├── SKILL.md                      # GATE：wiki 未配置则禁止启动
│   ├── wiki-config.json              # wiki 连接（init 生成，默认 enabled=false，已 gitignore）
│   └── scripts/md_to_wiki.py         # md → Confluence Storage Format XHTML 转换脚本
├── create-tech-md-doc/               # 从分支 diff 生成技术方案 md（8 模块）
│   ├── SKILL.md
│   └── template.md
└── create-release-md-doc/            # 从分支 diff 生成上线方案 md（6 模块）
    ├── SKILL.md
    └── template.md
```

## 参数



| 参数                      | 说明                                                                    |
| ----------------------- | --------------------------------------------------------------------- |
| `-Envs` / `--envs`      | 环境列表，逗号分隔：`codex,claude,doubao,qwen`；`all` = 全部                       |
| `-SkipDb` / `--skip-db` | 跳过数据库连接配置（database-query 不生成 config.json）                             |
| `-Yes` / `--yes`        | 非交互：自动使用已有数据库配置（依次查找 `.codex/database-query/config.json` 与各环境已安装的 `database-query/config.json`）；都没有且未 `-SkipDb` 时报错退出 |
| `-h` / `--help`         | 帮助                                                                    |

## 重跑与升级

可以放心重复执行 init 来升级模板：

* `SKILL.md`、`references/checklist.md`、`template.md`、脚本等**模板文件会被更新**；
* 用户填过的 `md-to-wiki/wiki-config.json`、`database-query/references/schema.md` **保留不覆盖**；
* `database-query/config.json` 只在本次确认或填写了数据库配置时写入；`--skip-db` 时保留已有文件；
* `.gitignore` 规则无论是否配置数据库都会补齐（只追加缺失的行）；
* `init-skills.sh` 兼容 macOS 自带的 bash 3.2。

## 凭据安全



* **数据库**：连接配置从已有 `.codex/database-query/config.json` 自动迁移，或按提示填写。

  生成后 `**/database-query/config.json` 追加到 `.gitignore`，**请勿提交**。

* **wiki**：连接配置**默认留空**（`enabled: false`）。启用时填写各环境

  `md-to-wiki/wiki-config.json` 的 `base_url` / `api_token`；`**/wiki-config.json` 同样加入

  `.gitignore`，**请勿提交**。

* 技能内置安全规则：database-query 只读查询优先、写操作必须用户确认、敏感字段脱敏、

  不在对话中输出密码。

## wiki 能力说明（连接空着不启动）



* `md-to-wiki` 带 **GATE**：执行前先读 `wiki-config.json`，若文件缺失 / `enabled` 非 true /

  `base_url` 为空 → **立即停止**，提示用户补配，不做任何转换与上传。

* `create-tech-md-doc` / `create-release-md-doc` 的 `--prd`**&#x20;增强**同样受 GATE 约束：

  未配置时自动回退纯 diff 流程（文档生成主流程不受影响）。

* 启用方式（三选一）：

1. 填写 `md-to-wiki/wiki-config.json`：`enabled: true` + `base_url`（如

   `https://wiki.example.com`）+ `api_token`（Confluence PAT）；

2. 环境接入 Confluence MCP（如 Claude Code 的 `wiki-mcp`），SKILL.md 会优先走 MCP 通道；

3. 同时保留 `remote_url` 字段记录远程 MCP 地址（可选）。

* 上传通道自动选择：环境有 wiki MCP 工具 → 用工具；否则用 `wiki-config.json` 的 REST 参数

  调 Confluence REST API。

## 产物输出规范（统一落位）

所有技能生成的**文档产物**统一按 `<根>/技能名/` 落位（四环境一致，不再依赖 `.claude/`）：



| 技能                    | 产物         | 规范路径                                                               |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| code-review           | 审查报告（md）   | `docs/skills/code-review/review-<范围>-<YYYYMMDD>.md`                |
| create-tech-md-doc    | 技术方案（md）   | `docs/skills/create-tech-md-doc/tech-doc_<分支>_<YYYYMMDD>.md`       |
| create-release-md-doc | 上线方案（md）   | `docs/skills/create-release-md-doc/release-doc_<分支>_<YYYYMMDD>.md` |
| database-query        | 查询结果       | 默认对话输出；导出时 `tmp/skills/database-query/result-<时间戳>.csv`            |
| md-to-wiki            | 转换临时 XHTML | `tmp/skills/md-to-wiki/_wiki_upload_<时间戳>.html`（上传后可删）             |

规则：



* `docs/skills/` 是**持久产物**目录，可提交 git，团队共享。

* `tmp/skills/` 是**临时产物**目录，`init-skills` 自动把 `/tmp/` 加入 `.gitignore`，不入库。

* 同路径已存在时加 `_v2`、`_v3`，不覆盖旧文件。

* 存量历史产物（项目根 `code-review-*.md`、`.claude/docs/` 下的 `tech-doc_*` / `release-doc_*`）

  属此前规范遗留，新产物按上表落位；需要归档迁移可自行移动，不影响本规范。

## 自定义模板

初始化命令与模板集中在 `skills-init/` 一个文件夹（`.tpl` 后缀不会被任何平台误加载）：



```
skills-init/
├── init-skills.ps1                    # Windows 初始化命令
├── init-skills.sh                     # bash 初始化命令（macOS/Linux/Git Bash）
├── README.md                          # 本说明
├── database-query/
│   ├── SKILL.md.tpl
│   ├── config.json.tpl
│   └── references/schema.md.tpl
├── code-review/
│   ├── SKILL.md.tpl
│   └── references/checklist.md.tpl
├── md-to-wiki/
│   ├── SKILL.md.tpl
│   ├── wiki-config.json.tpl
│   └── scripts/md_to_wiki.py          # 纯拷贝（无占位符）
├── create-tech-md-doc/
│   ├── SKILL.md.tpl
│   └── template.md                    # 8 模块文档模板（纯拷贝）
└── create-release-md-doc/
    ├── SKILL.md.tpl
    └── template.md                    # 6 模块文档模板（纯拷贝）
```



* 修改 `SKILL.md.tpl` 可调整触发词、工作流、输出模板（四环境共用同一份）。

* `code-review` 的 checklist 含 Nacos 远程配置审查维度，适配本项目约定；其他项目可按需编辑。

* 安装后建议运行一次 `SHOW TABLES` 并 `DESCRIBE` 关键表，把结构补进

  `<env-dir>/database-query/references/schema.md`，能显著提升查库效率。

* 技术 / 上线方案的 `template.md` 保留团队模板占位（如数仓评审、Diamond 服务参数），

  其他项目按自身流程调整。

## 为什么这些路径



* **Codex CLI 项目级 skills** 官方约定为 `.agents/skills/`（团队提交即共享），与豆包办公

  的项目级技能目录一致，因此两者共用一份。

* **Claude Code** 项目级为 `.claude/skills/`，自动发现。

* **Qwen Code** 项目级为 `.qwen/skills/`，自动发现。