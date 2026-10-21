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
| `toolchain` | 可选，开发环境配置：`java_home`、`maven.{settings,repository}`、`gradle_user_home`、`node`，都是路径。**写本机绝对路径，或在 `env_vars` 里声明的变量**（如 `$JAVA_HOME`、`%JAVA_HOME%`）；路径里有空格照常写。写入前用 `resolve.mjs env --check` 核对文件 / 目录确实存在。各人机器不同：团队共用一份环境约定时写在这里，个人机器不同就写进 `profile.local.json` 的同名字段（覆盖 `profile.json`；**写 `""` 表示不用团队那个值**，见下）。`maven.settings` 按 Maven 的实际规则取值：全局（`$MAVEN_HOME/conf/settings.xml`）与用户级（`~/.m2/settings.xml`）**会合并、以用户级为准**，所以推断出的通常是用户级那份，全局的记在 `evidence` 里 | dev 构建与测试（编译 / 测试跑不起来时先核对）、交付说明与上线方案的「环境」说明 |
| `env_vars` | 可选，`toolchain` 里用到的变量与构建需要额外设置的环境变量，如 `{"JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home", "MAVEN_OPTS": "-Xmx2g"}`。**不含凭据**（token、密码、内网密钥一律不写） | `toolchain` 的变量展开、dev 写终端命令 |
| `toolchain_note` | 可选，一句话的环境说明（如「启动需要本地 Redis」这类与构建环境有关的约定放 `notes`，这里只写工具链差异，如「公司镜像源在 settings.xml 里配好了」） | dev 排查环境问题 |
| `notes` | 其他项目约定，一条一句（如「启动需要本地 Redis」） | 全部 |
| `artifacts` | 可选：`{ "project": "order-service", "commit_prompt": true }`。`project` 是这个项目的产物目录名（产物在 `workflow-run/docs/requirements/<需求名>/<项目名>/`，随代码提交和独立文档仓库两种用法都一样）：随代码提交时不配置就取 git 远端仓库名，第一次落盘时自动写进来；独立文档仓库时要先配置；`commit_prompt: false` 关闭写完后的提交提示。个人设置可写在 `workflow/profile.local.json`（不提交）覆盖 | 见 `references/requirements.md`，用 `requirement.mjs config` 修改 |
| `review` | 可选，审查范围与项目规则，如 `{"exclude": ["**/legacy/**"], "include": ["docs/api/**/*.md"], "rules": [{"path": "**/*Mapper.xml", "rule": "分页查询必须带 ORDER BY 主键"}]}`。`exclude` 不审；`include` 把默认跳过的生成文件、文档、本工具产物加回来（删除、二进制、敏感文件加不回来）；`rules` 按 glob 匹配文件路径（不含 `/` 的模式匹配文件名，`**` 跨目录，`{a,b}` 多选），匹配到的规则和审查清单一起检查，不替换清单 | `review-scope.mjs`（project-review、dev 自审） |
| `docnexus_categories` | 可选，覆盖各 skill 写入 DocNexus 时的分类，如 `{"create-tech-md-doc": "技术方案"}`；不填用 skill 默认 | 见 `references/docnexus.md` |

其他 skill 读画像统一用 `node <skills>/workflow/scripts/resolve.mjs profile`：输出 `profile`（文件内容）、`empty`（空字段）、`complete`（`main_branch` / `build` / `test` 都已填写）、`env`（本机系统与终端，见下）。

## 个人设置 `workflow/profile.local.json`

不提交（已在 `.gitignore` 里），每个人、每台机器各一份：

- `env`：`{ "os": "windows", "shell": "pwsh" }`，安装 / 升级时由安装器检测并写入，不用手填。`os` 是 `windows` / `macos` / `linux`；`shell` 在 Windows 上是 `pwsh`（PowerShell 7）或 `powershell`（Windows PowerShell 5.1，没有 `&&`），其他系统是 `$SHELL`（如 `zsh`、`bash`）。`resolve.mjs env` / `profile` / `status` 输出它，skill 写终端命令时按它来，不再自行探测；没记录时 `source` 为 `runtime`、`shell` 为 `null`，重跑安装器即可补上。
- `artifacts`：覆盖 `profile.json` 的同名字段（目前用于 `commit_prompt`），用 `requirement.mjs config --local` 修改。
- `toolchain` / `env_vars`：覆盖 `profile.json` 的同名字段。**JDK、Maven、Node 的位置每台机器不一样**，团队共用的画像里写的是约定值，个人机器不同就写这里（`profile.local.json` 优先）。`/workflow profile` 检测到不一致时会问你是写团队的那份还是自己这份。
- **`""` 和「没写」不一样**：字段写 `""` 表示本机**不使用**团队那个值（例如团队配了内网 `settings.xml`，你的机器想用 Maven 默认配置 → `"maven": { "settings": "" }`）；没写这个键才表示沿用团队值。被清空的字段不再校验、也不报缺失，`env --check` 输出里列在 `cleared`。

## 开发环境配置（`toolchain` / `env_vars`）

构建和测试命令能不能跑起来，往往取决于 JDK 在哪、Maven 用哪个 `settings.xml`、本地仓库在哪个盘。这些不写死在模板里，统一由画像提供：

```json
{
  "toolchain": {
    "java_home": "$JAVA_HOME",
    "maven": { "settings": "$HOME/.m2/settings.xml", "repository": "/data/maven-repo" },
    "gradle_user_home": "",
    "node": ""
  },
  "env_vars": { "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" }
}
```

- 路径里的 `$VAR` / `${VAR}` / `%VAR%` 用 `env_vars` 或进程环境展开；`$HOME`（`~`）展开为当前用户目录。展开后是空的，`env --check` 会按「变量没配」报出来。
- **Maven 的取值顺序**：`maven.settings` 推断用户级 `~/.m2/settings.xml`（存在时），否则全局 `$MAVEN_HOME/conf/settings.xml`——Maven 会合并两份、用户级优先，私服和镜像通常配在用户级。`maven.repository` 取有效配置里的 `<localRepository>`（用户级优先，其次全局），都没有才是默认 `~/.m2/repository`。`settings.xml` 里注释掉的示例节点不算有效配置。
- **本项目 Node 版本可能和系统默认不同**，`node` 指本项目要用的 Node（如 `nvm` 的某个版本目录）；不填就用 `PATH` 里的。
- 写入前必须核对：`node <skills>/workflow/scripts/resolve.mjs env --check` 逐个字段给出 `resolved`（展开后的路径）、`exists`，以及 `current`（本机当前进程的 `JAVA_HOME` / `MAVEN_HOME` / `NODE`）便于对照。**不存在或对不上的不要写进画像**，先问用户；用户也不知道就留空，不猜。
- 这里只放路径和普通环境变量。**token、密码、密钥、内网凭据一律不写**（画像会随代码提交）；需要凭据的走 `database-query/config.json` 的 `password_env` 这类机制，或写在个人的 `profile.local.json` 之外由用户自己 export。

## 填写与更新

由 `/workflow profile` 触发，或其他 skill 首次需要某个字段但它为空时触发：

1. 运行 `node <skills>/workflow/scripts/resolve.mjs infer-profile`：按固定规则从构建文件、Makefile、依赖与配置文件、`git symbolic-ref refs/remotes/origin/HEAD` 推断草稿，`evidence` 给出每个字段的依据，`unknown` 是推断不出的字段。`toolchain` 也一起推断（构建文件对应的工具、`JAVA_HOME` / `MAVEN_HOME` / `NODE` 进程变量、`~/.m2/settings.xml` 与其 `<localRepository>`、`~/.gradle`），同样带依据。脚本覆盖不到的约定再补读 `CLAUDE.md` / `AGENTS.md`、CI 配置。
2. 推断不出的字段（发布平台、Region、是否数据评审）问用户；用户不知道就留空，**不要沿用其他项目的取值**。
3. 把拟写入的完整 JSON 给用户确认，确认后再写入；未确认则只在本次对话中使用。
4. 只改用户确认的字段，保留其他已有字段。`toolchain` / `env_vars` 逐个子字段合并：只覆盖用户确认过的键，`maven.settings` 这类没确认的不动。
5. 写完再跑一次 `resolve.mjs env --check`，把不存在或展开为空的路径告诉用户（推断依据可能来自别的机器，尤其是 `JAVA_HOME`）。团队画像里的路径在本机对不上时，问用户是写进自己的 `profile.local.json` 还是更新团队那份。
