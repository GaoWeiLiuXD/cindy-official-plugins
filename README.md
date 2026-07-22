# cindy-official-plugin

Cindy 官方内置插件（Ghost / 意识）种子仓。作为 Cindy 桌面端客户端的 submodule 随客户端一起分发，并在客户端启动时自动播种安装。

## 内容

每个子目录 = 一个意识包源码（`ghost.json` 身份卡 + `main.js` 等），根目录 `provisioning.json` 声明各插件的受众（audience）与档位（tier）。

| 插件 | 说明 |
|---|---|
| `cindy-art` | 图片 / 短视频生成 |
| `cindy-github` | GitHub issue / PR / 仓库操作 |
| `cindy-gitlab` | GitLab issue / MR / 仓库操作 |
| `cindy-mermaid` | Mermaid 图表绘制 |
| `cindy-web-search` | 公网搜索（Brave / Tavily） |

## 开发

- 意识编写契约以客户端总机工具 `ghost_forge_guide` 现拿现读的 `FORGE_GUIDE` 为准。
- 改动流程：本仓提 PR 合入后，由客户端更新对本仓的 submodule 指针。dev 环境下改本地文件重启即生效（播种按内容指纹收敛，不看 version 字段）。
- `provisioning.json` 解析失败时客户端按 fail-closed 处理（本种子根整轮跳过播种），改动后务必保证 JSON 合法。
