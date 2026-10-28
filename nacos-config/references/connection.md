# 连接配置

本 skill 目录中的 `config.json` 是可选本机文件，安装和升级不会覆盖，安装器会将其加入 `.gitignore`。不要求把 application 的密码复制过来。

```json
{
  "default_connection": "test",
  "connections": {
    "test": {
      "server_addr": "https://nacos.example.com/nacos",
      "namespace": "test-namespace-id",
      "group": "DEFAULT_GROUP",
      "api_version": "2",
      "username_env": "NACOS_USERNAME",
      "password_env": "NACOS_PASSWORD"
    },
    "prod": {
      "server_addr": "https://nacos-prod.example.com/nacos",
      "namespace": "prod-namespace-id",
      "api_version": "3",
      "token_env": "NACOS_PROD_TOKEN"
    }
  }
}
```

`inspect` 列出连接名称；`get --conn test` 显式选择。未传 `--conn` / `--file` 时只使用有效的 `default_connection`，否则要求选择，不自动取第一个。配置 JSON 不支持明文 `password` / `token`，使用环境变量；`username` 可直接填写。指定的凭据环境变量缺失时拒绝请求。

`server_addr` 支持单个 `host:port`（按 HTTP）或完整 HTTP(S) URL。不带路径时追加 `/nacos`，自定义 context path 按 URL 保留。不接受 URL 用户信息、查询参数、片段或逗号分隔的服务器列表；集群需选择一个已确认入口。保留 TLS 证书校验。

`--api-version 1|2|3`、`--namespace <ID>`、`--group <名称>` 可覆盖所选连接。`--timeout <秒>` 默认 15 秒，每次请求生效。公共命名空间可留空；脚本按各版本协议转换 public。

| 版本 | 只读配置接口 | 登录接口 | 配置响应 |
|---|---|---|---|
| 1（默认，兼容 1.x / 2.x） | GET `/v1/cs/configs`，`tenant` / `group` / `dataId` | POST `/v1/auth/login` | 配置原文 |
| 2 | GET `/v2/cs/config`，`namespaceId` / `group` / `dataId` | POST `/v1/auth/login` | `code: 0`，`data` 为原文 |
| 3 | GET `/v3/client/cs/config`，`namespaceId` / `groupName` / `dataId` | POST `/v3/auth/user/login` | `code: 0`，`data.content` 为原文 |

1 / 2 版 token 按兼容协议放在请求参数中，3 版放在 `accessToken` 请求头中；脚本不输出请求 URL、token、登录响应或服务端原始错误体。网关若不兼容默认登录路径，可用 `token_env`。云厂商 AK/SK、专有鉴权插件、配置加密插件不在首版支持范围，不能把加密结果当成明文值。

本地配置支持 YAML 的普通嵌套、点分 key、数组和多文档，以及 Java properties 的转义、续行和 Unicode。`--profile` 仅选择精确名称（或逗号分隔的名称列表），不计算 Spring 表达式；文件覆盖顺序由重复的 `--file` 决定，不自动激活 `spring.profiles.active`、profile group 或加载外部文件。Maven `@...@` 过滤值、未解析的连接占位符会拒绝请求。

远程支持 JSON、YAML、properties；解析后输出点分属性（数组用数字下标）。`--key a.b` 匹配 `a.b` 或 `a.b.*`，敏感父节点下的全部子项均脱敏。其他格式不输出原文，需先明确如何解析。

协议依据：[Nacos 1.x API](https://nacos.io/en/docs/v1/guide/user/open-api/)、[Nacos 2.x API](https://nacos.io/en/docs/v2/guide/user/open-api/)、[Nacos 3.x Client API](https://nacos.io/en/docs/v3.0/manual/user/open-api/)、[Nacos 鉴权](https://nacos.io/en/docs/latest/manual/admin/auth/)。
