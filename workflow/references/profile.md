# 项目画像（workflow/profile.json）

所有 skill 共用的项目事实，放在本 skill 目录下，**不含任何凭据**，可以提交到 git。缺失的字段一律视为空。

| 字段 | 含义 | 谁在用 |
|---|---|---|
| `main_branch` | 主分支名，diff 基线 | dev、project-review、文档类 |
| `build` / `test` / `lint` | 构建、全量测试、静态检查命令 | dev |
| `test_single` | 只跑一个测试的命令，`{target}` 为测试类或文件，如 `mvn -q test -Dtest={target}` | dev |
| `config_center` | 配置中心：`nacos` / `apollo` / `spring-cloud-config` / `none`，空 = 未知 | project-review 第 10 维度、dev 配置清单、上线方案 |
| `deploy.platform` | 发布平台名称（如公司内部发布系统） | 技术 / 上线方案「上线服务」 |
| `deploy.regions` | 可选的部署环境 / Region 列表 | 技术 / 上线方案 |
| `job_annotation` | 定时任务注解（如 `@XxlJob`、`@Scheduled`） | 技术方案「定时任务变更」 |
| `data_review` | 上线前是否需要数据团队评审库表（`true` / `false`） | 技术方案模块 7、上线方案 2.3 |
| `notes` | 其他项目约定，一条一句（如「启动需要本地 Redis」） | 全部 |
| `docnexus_categories` | 可选，覆盖各 skill 写入 DocNexus 时的分类，如 `{"create-tech-md-doc": "技术方案"}`；不填用 skill 默认 | 见 `references/docnexus.md` |

其他 skill 读画像统一用 `node <skills>/workflow/scripts/resolve.mjs profile`：输出 `profile`（文件内容）、`empty`（空字段）、`complete`（`main_branch` / `build` / `test` 都已填写）。

## 填写与更新

由 `/workflow profile` 触发，或其他 skill 首次需要某个字段但它为空时触发：

1. 运行 `node <skills>/workflow/scripts/resolve.mjs infer-profile`：按固定规则从构建文件、Makefile、依赖与配置文件、`git symbolic-ref refs/remotes/origin/HEAD` 推断草稿，`evidence` 给出每个字段的依据，`unknown` 是推断不出的字段。脚本覆盖不到的约定再补读 `CLAUDE.md` / `AGENTS.md`、CI 配置。
2. 推断不出的字段（发布平台、Region、是否数据评审）问用户；用户不知道就留空，**不要沿用其他项目的取值**。
3. 把拟写入的完整 JSON 给用户确认，确认后再写入；未确认则只在本次对话中使用。
4. 只改用户确认的字段，保留其他已有字段。
