# workflow-run — 项目级 Agent Skills 一键初始化

为团队项目安装 **9 个 skills**：workflow、dev、project-review、code-graph、database-query、nacos-config、md-to-wiki、create-tech-md-doc、create-release-md-doc，覆盖开发、审查、配置查询和文档交付。

支持 Codex CLI、Claude Code、豆包办公、Qwen Code 和腾讯 WorkBuddy。由宿主代理读取规则并执行脚本，无需常驻 Agent 服务。

## 首次安装

需要 **Node.js >= 22.13** 和 npm。在业务项目根执行；Windows 使用管理员终端：

```bash
npx @rowansenne/workflow-run --with-codegraph
```

按提示选择代理环境、配置数据库。DocNexus 文档库必装并自动接入；CodeGraph 可选，不需要时去掉 `--with-codegraph`。

只安装 Codex 环境、暂不配置数据库：

```bash
npx @rowansenne/workflow-run --envs codex --yes --skip-db
```

安装后重新打开代理会话，运行 `/workflow profile` 填写项目画像，再用 `/workflow status` 检查状态。明确输入 `/dev` 才进入完整开发工作流；普通分析、修改、测试请求不会自动启动 dev。

[安装选项与 Windows 说明](docs/installation.md) · [分步图文教程](docs/full-install.html) · [工作流与命令](docs/workflows.md)

## 团队共享

- 将 `.agents/skills/`、所选环境的 skills 链接、项目画像 `workflow/profile.json` 和安装器生成的项目说明提交到代码仓库。
- 业务场景清单、需求文档、方案、审查和交付说明统一放在 `workflow-run/docs/requirements/`；知识与团队模板放在 `workflow-run/docnexus/`。
- `.docnexus/` 的项目配置、npm 清单和锁文件随代码提交，运行依赖在每台机器上安装。
- 数据库、wiki、Nacos 本机连接配置、`profile.local.json` 和 `workflow-run/tmp/` 不提交；安装器会追加对应忽略规则。

团队成员克隆后，在项目根运行以下命令补齐本机依赖与入口，再检查状态：

```bash
npx @rowansenne/workflow-run upgrade
npx @rowansenne/workflow-run doctor --offline
```

跨服务需求可共用独立文档仓库：

```bash
npx @rowansenne/workflow-run docs-repo <团队文档仓库地址>
```

[完整提交清单、文档仓库与模板定制](docs/team-guide.md)

## 个人配置

团队约定放在 `.agents/skills/workflow/profile.json`；本机工具链路径和个人偏好放在同目录的 `profile.local.json`，后者不提交。使用 `--copy` 时，路径随所选代理环境变化。

数据库连接由安装提示配置；wiki 默认关闭；Nacos 可从选定的 application / bootstrap 配置读取，也可使用本机命名连接。凭据不要写入团队画像。

[画像与工具链说明](docs/workflows.md) · [数据库、wiki 与 Nacos 凭据说明](docs/team-guide.md) · [DocNexus、CodeGraph、Nacos 与 wiki 集成](docs/integrations.md)

## 升级与故障恢复

```bash
npx @rowansenne/workflow-run doctor --offline   # 本地自检，不连接数据库
npx @rowansenne/workflow-run upgrade            # 更新 skills，保留用户配置
npx @rowansenne/workflow-run seed-templates     # 补导入缺少的默认模板
npx @rowansenne/workflow-run uninstall          # 按安装清单卸载
```

- **入口缺失或链接失效**：运行 `upgrade`，重新打开代理会话后再检查。
- **需要更新 DocNexus**：使用 `upgrade --with-docnexus`。当前旧布局清理会删除旧知识且不备份；涉及旧版本时，先保存知识目录，再按[升级说明](docs/integrations.md)处理。
- **模板缺失**：默认模板可用 `seed-templates` 补齐；技术方案、上线方案模板需按团队样例创建，见[模板定制](docs/team-guide.md)。
- **完整流程中断**：使用 `/workflow resume` 查看下一步；有待完成的产物收尾时，按状态提示恢复或取消。

[重装、升级、卸载与旧包改名](docs/installation.md) · [更新记录](CHANGELOG.md)

## 专题文档

| 文档 | 内容 |
| --- | --- |
| [安装与升级](docs/installation.md) | 环境路径、参数、Windows、安装清单、升级与卸载 |
| [工作流与命令](docs/workflows.md) | 项目画像、开发与修复、运行续接、反馈、脚本规则 |
| [外部能力集成](docs/integrations.md) | DocNexus、CodeGraph、Nacos、wiki |
| [团队共享、产物与模板](docs/team-guide.md) | 提交边界、凭据、文档仓库、模板定制 |
| [维护、测试与发布](docs/development.md) | 架构、仓库结构、skill 元数据、测试与发版 |
| [架构图解](docs/architecture.html) | 调用关系、开发流程、数据归属与知识闭环 |

维护本包时使用 `npm ci --ignore-scripts` 安装锁定依赖，`npm test` 运行全部测试；`npm run test:package` 可单独验证实际 npm 包的安装、执行和卸载。
