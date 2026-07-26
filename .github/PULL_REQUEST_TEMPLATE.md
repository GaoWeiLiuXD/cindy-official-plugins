<!--
Title format: <type>(<scope>): <short description>
  scope is normally the plugin directory, e.g. fix(qq-mail): validate the move result
  type: feat / fix / refactor / perf / chore / docs / test / revert / build / ci

标题格式：<type>(<scope>): <简短描述>
  scope 一般写插件目录名，例如 fix(qq-mail): 校验移动结果
-->

## What changed / 改了什么

<!-- Plugin(s) touched, and what this PR does. / 涉及哪些插件，这个 PR 做了什么。 -->

## Why / 为什么

<!-- Link the issue if there is one. / 有 issue 请关联。 -->

## Checklist

- [ ] Reviewed the complete diff — no credentials, tokens, authorization codes,
      real user data, unrelated generated files, or `node_modules`.
      已 review 完整 diff —— 无凭证、令牌、授权码、真实用户数据、无关生成文件或 `node_modules`。
- [ ] Bumped `ghost.json` `version` for every plugin whose packaged content
      changed. 每个打包内容发生变化的插件都已 bump `ghost.json` 的 `version`。
- [ ] Ran `node --test .tests/localization.test.mjs` if any `ghost.json` or
      `locales/` changed. 改动过 `ghost.json` 或 `locales/` 的已跑本地化检查。
- [ ] Rebuilt `node/worker.cjs` via `npm ci && npm run build` and committed the
      artifact, if `src/` changed. 改过 `src/` 的已重新构建并提交产物。
- [ ] Updated the plugin's `THIRD-PARTY-LICENSES.txt` if a bundled dependency was
      added or upgraded. 内嵌依赖有增减或升级的已更新第三方许可证清单。
- [ ] Every commit is signed off (`git commit -s`) — see [DCO](https://github.com/makecindy/cindy-official-plugins/blob/main/DCO).
      每个 commit 都带 DCO 签名。

## Tool declaration changes / 工具声明改动

<!--
If ghost.json tools[].description or parameters changed, describe the impact on
Agent behaviour — that description is the manual the Agent reads.
如改动了 ghost.json 的工具声明，请说明对 Agent 行为的影响 —— 那段描述就是 Agent
读到的使用手册。Leave blank if not applicable. / 不涉及可留空。
-->

## Verification / 验证

<!-- Commands actually run and their results. / 实际执行的命令和结果。 -->
