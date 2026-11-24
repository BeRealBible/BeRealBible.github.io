# V25 账号与同步：配置与发布验收

## 读者路径

阅读栏 → 阅读设置 → 登录与同步 → 填邮箱、输入验证码 → 按需开启云端同步。游客仍可以使用所有阅读功能，也可以在此浏览器保存进度、阅读历史、置顶书签、高亮。不登录不能云端备份或跨设备恢复这些记录。

登录不自动读取或上传进度、历史、书签或高亮。启用阅读同步时默认不导入游客档，勾选才将游客档中缺失于云端的记录补进账号档（既有云端值优先）。独立离线 HTML 没有账号入口，不联网。退出将阅读器切回原游客档；未发出的更改仍留在对应账号的本机缓存，换一个账号不会读到。登录会话存在当前浏览器标签页中，关闭标签页后通常需再验证；浏览器恢复标签页可能也恢复其会话，共用设备请主动退出。浏览器缓存不是加密保险箱；仅将已审查、可信的脚本和页面放在承载账号功能的同一网站源上。

进度、整份历史/置顶列表、单条高亮分别写入。不同记录在服务端合并；两台设备同时改同一条记录、或同时修改历史列表，后成功提交的版本为准。删除高亮同步成 `0` 标记，不会因旧设备随后读取而自动复活。后台同步不会移动当前书页；从「继续同步的进度」主动恢复。此版按纸本版次隔离记录，未来更换版式标识时要设计显式迁移，不能用旧页码强行映射。

私人笔记在登录后可写、可读，由独立表与接口保存，无需开启阅读记录同步。每次落字、粘贴及删除都立即排队提交；连接慢时等同一条上一笔确认后逐笔提交，只有无待确认写入时显示「已同步」。断网时保留本标签页的待发队列，恢复连接自动补传；同一标签页刷新可恢复队列，断网时完全关闭标签页前请先保留正文。前台的其他设备约每五秒读取更新，返回前台时立即拉取。同一条笔记遇不同正文的同时编辑会保留本机文字并提示冲突，不覆盖云端。

## 启用测试环境

1. 准备专用于此阅读器的 Supabase 项目。空配置不向任何账号服务发请求。先从其 SQL Editor 执行 `supabase/migrations/20261123000100_v25_account.sql`。它按登录用户的 ID 隔离数据库记录并拒绝匿名访问；不向表里写邮箱。只有账号服务保存邮箱。确认项目 API 可访问 `public` 架构。
2. 开启 Email 登录，在 Supabase 配置自己的 SMTP 发信服务（按服务商要求验证发信域名）。默认发信只面向团队邮箱，且新建免费项目用默认发信时无法修改邮箱模板，不能满足此版数字验证码流程。SMTP 凭证只填在 Supabase 后台。把 **Magic Link / OTP** 与 **Confirm sign up** 两个模板都改为显示 `{{ .Token }}` 的验证码（例如 `你的纸页登录验证码：{{ .Token }}。如果不是你请求的，请忽略。`）。未自动确认的首次注册走 Confirm sign up，已验证邮箱再次登录走 Magic Link / OTP。见 [邮箱验证码](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[发信配置](https://supabase.com/docs/guides/auth/auth-smtp)、[首次与再次登录的后端分支](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go)。
3. 在 `v25/account-config.js` 写入 `https://<project>.supabase.co`、`sb_publishable_` 开头的 Publishable key，只接受这类前端公开键。不把 `sb_secret_`、`service_role`、SMTP 密码或实际验证码加入 Git。使用 HTTPS 预览，或在本机 HTTP loopback 预览；不要通过网址查询参数传入密钥。执行 `node tools/stamp-preview.cjs . --index-only` 更新缓存指纹。
4. 公布前用两个独立的测试邮箱、两个浏览器及手机网络验证实际收信、首次/再次登录、浏览器退出、导入、恢复、失败提示和跨账号隔离；用真实项目验证对匿名设备与另一个已登录用户都不可读写。先小范围邀请并配置 Supabase 侧邮件频率控制及注册控制，避免公开发信接口被滥用；根据读者量评估打开公开注册。原正式入口只在上述验收后启用配置，然后从公网复验。
5. 笔记另需执行 `supabase/migrations/20261124000100_v25_notes.sql`，不改既有阅读档表。在独立 HTTPS 源设置 `notesOrigin` 为实际来源，例如 `https://reader.example.org`，不加仓库子目录；本机回环允许测试。同一账号分别验证不启用阅读同步也能逐笔写入、手机端恢复、断网补传；用不同账号验证不可互访。正式发版前用连续输入估算逐笔写入和前台读取的实际负载。

## 本地自动验收

- `node tools/preview-v25-account.cjs`：在本机访问 `http://127.0.0.1:37875/account-setup`，给当前标签页配置真实后端进行发信、登录及同步验收。只接受浏览器公开配置，不把项目地址或键写入正式发布配置，不对局域网或公网开放。
- `node test-v25-account.cjs`：配置拒绝私钥、认证请求、游客导入范围、账号隔离、同步期间的新写入保护。
- `node test-v25-account-db.cjs`：需要 PGlite（或设置 `PGLITE_MODULE`）。用本地 PostgreSQL 兼容运行时执行实际迁移，验证匿名拒绝、两个账号读写隔离、导入不覆盖、删除标记；本地模拟 `auth.uid()`，不替代真实 Supabase 部署验收。
- `node test-v25-account-browser.cjs`：需要 Playwright/Chrome，可设置 `PLAYWRIGHT_MODULE`、`BROWSER_EXE`。浏览器测试使用假验证码及模拟接口，没有真实发信；可给 `PREVIEW_FILE` 设置刚构建的离线文件并附验离线版。
- `node test-v25-notes.cjs`、`node test-v25-note-sync.cjs`：验证共用经文坐标、逐笔提交、同标签页待发恢复、另一台设备的冲突保护；设置 `PGLITE_MODULE` 还会跑实际笔记迁移与两个账号的权限测试。
- `node test-v25-notes-browser.cjs`：用 Chrome 桌面及模拟手机视口、模拟账号和接口，检查每次正文改动的请求、确认状态、编辑/查看、中文输入法事件和跨设备读取。

若服务故障或临时不开放注册，不要用私钥绕过规则。撤回配置并重打指纹可恢复纯游客发布，不会删除既有的游客档或云端记录。

## 正式入口发布检查

- 真实验收：邮箱验证码登录通过；Edge 写入的创世记 1:24 高亮在 Supabase 查到，并在登录前无高亮的 Chrome 中恢复。尚不等同于不同手机号网络或第二只邮箱的完整验收。
- 2026-11-24：Supabase 已部署笔记迁移，两测试身份在真实数据库中验证按顺序写入、读取和跨账户隔离，测试事务回滚；匿名公网请求明确被拒绝。
- `paper-bible-demo` 与 `emmaus-paper-study-demo` 曾共用 `https://xxmm1221.github.io`，浏览器不会按仓库路径隔离 Web Storage。当前同步实现将账户缓存存入 `localStorage`；不能把键名前缀当作跨项目的安全隔离。这是发布前发现的架构边界，不代表已观察到数据被其他页面读取。先在另一个 GitHub 所有者的 Pages 上构建并验证 Demo，才停用 Demo 原仓库的 Pages；旧仓库及备份保留。Demo 自己保存在浏览器的记录不会随网站地址自动转移。参见 [浏览器同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#cross-origin_data_storage_access)。
- 2026-11-24：Demo 已在 `https://berealbible.github.io/emmaus-paper-study-demo/` 发布；新旧首页指纹一致，实开经文和注释正常。旧仓库已停用 Pages 并保留代码，旧 Demo 路径及主页返回 404，原纸圣经入口响应 200 且不跳转。
- 为保留原读经网址而启用账号前，使用站点所有者已授权的 GitHub CLI 执行 `node tools/check-v25-pages-isolation.cjs`，并检查 Demo 新网址可用、旧地址不再托管内容。验收成功才可把 `notesOrigin` 设置为 `https://xxmm1221.github.io` 并设 `pagesIsolationVerified:true`。未设置时原站继续作为游客入口。账号一旦公开，访客浏览器中可能留有私人缓存；即使后来回滚账号配置，也不要在同一主机名重新启用其他项目。需要回滚 Demo 时仍在其新主机名上处理。

## BeRealBible 正式域迁移

- 正式域由 `BeRealBible/BeRealBible.github.io` 的 `main` 分支直接托管 `https://berealbible.github.io/`。该域曾托管 `emmaus-paper-study-demo`，不能把正式站和 Demo 分别放在根目录与子目录来视为隔离。
- 先准备正式版代码并验证根目录资源，旧读经入口保留。待 Demo 的该域发布停用，再验证 `node tools/check-v25-pages-isolation.cjs --official`。通过才置 `pagesIsolationVerified:true` 并发布账号入口。正式域公布后也不得在该域另开其他项目，即使暂时撤回账号配置。
- 2026-11-24：经确认停用 `BeRealBible/emmaus-paper-study-demo` 的 Pages，未删除或归档仓库，部署分支仍指向原提交。正式根站构建后，已验证该组织下只有正式站启用 Pages、旧 Demo 路径返回 404、正式根网址响应 200 不跳转。
- 使用同一 Supabase 项目和纸本版次，不迁表、不重置用户、不自动拷贝本机数据。读者在新网址以同一邮箱登录，已有云端笔记可读；需在账号面板开启阅读记录同步来恢复已同步的高亮、进度与历史。未同步的记录仍可从旧入口处理。
