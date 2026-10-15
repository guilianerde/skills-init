# 分支审查：读 diff 的策略

基线、排除规则、按层过滤的路径见 `references/diff-collection-common.md`（与文档类 skill 共用）。本文件只写审查特有的部分：改动多时**先审风险高的，按批精读，审不到的如实写进报告**，而不是每个文件都扫一眼。

## 1. 先量规模

```bash
git diff <main>...<dev> --shortstat
git diff <main>...<dev> --name-only            # 再按 diff-collection-common.md 的排除规则去掉测试、生成代码、文档
git diff <main>...<dev> --stat -M -w            # -M 识别重命名，-w 忽略纯空白改动
```

| 规模（排除后） | 做法 | 报告「审查方式」 |
|---|---|---|
| ≤ 30 个文件且 ≤ 1500 行改动 | 全量精读 | 全量精读 |
| 更大 | 按下面的风险分级分批 | 分批精读（N 批，按风险排序） |
| > 500 个文件且无法再过滤 | 停，请用户按模块或提交区间缩小范围 | — |

纯重命名 / 格式化 / 批量替换（`--stat -M -w` 后几乎没有剩余改动的文件）归入 P2，只确认替换是否完整、有没有漏改的调用方。

## 2. 风险分级

| 级别 | 范围 | 识别方式 |
|---|---|---|
| **P0** | 资金 / 账务 / 支付回调、事务与锁、权限校验、SQL / DDL / mapper XML、对外接口签名、MQ 生产与消费、配置 | 路径（`controller`、`mapper`、`*.sql`、`*.xml`、配置文件）+ 下面的关键字 |
| **P1** | 其余业务逻辑（service / handler / job）、实体 / DTO / VO 与转换器 | `diff-collection-common.md` 的业务逻辑层、数据结构层 |
| **P2** | 工具类、日志、纯重构、测试 | 其余文件 |

按关键字找出 P0 文件（`-G` 只列「增删行」命中正则的文件；关键字按项目技术栈增减）：

```bash
git diff <main>...<dev> --name-only -G '@Transactional|synchronized|Lock\b|@Version|BigDecimal|amount|balance|@KafkaListener|KafkaTemplate|@PreAuthorize|\$\{|ALTER TABLE|CREATE TABLE|DELETE FROM|UPDATE .* SET'
```

## 3. 分批精读

- 每批不超过约 15 个文件或 800 行改动，P0 → P1 → P2。
- 每个文件读 `git diff <main>...<dev> -- <文件>`，并用 `git show <dev>:<文件>` 读改动所在方法的上下文（调用方、判空、事务注解），不只看 hunk。
- 每批结束先把发现记下来（文件:行号 + 一句话）再进入下一批，防止后面的批次挤掉前面的结论；批次多时可以边审边把发现写进报告草稿。
- 时间或上下文不够时，**P2 可以只看 `--stat`**，但要在报告「未覆盖与待确认」里列出只扫过 `--stat` 的文件；P0 不能跳过。

## 4. 未提交改动

审查工作区（dev 自审或用户说「我刚改完，帮我看看」）：`git diff HEAD`（已暂存和未暂存一起）；分支已有提交时再加 `git diff <main>...HEAD`。新建但未跟踪的文件用 `git status --short` 找出来逐个读。
