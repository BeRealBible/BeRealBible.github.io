# BeRealBible 正式入口及兼容网址

- 正式入口为 `https://berealbible.github.io/`，无需 `?v=index-25`；发布验收确认登录和写笔记入口均不离开此来源。
- `https://xxmm1221.github.io/paper-bible-demo/?v=index-25` 是保留的旧版兼容入口。新旧使用同一个 Supabase 项目和纸本版次；已同步的数据重新登录后可恢复。旧浏览器的游客记录还留在旧入口，不自动转移。
- 在干净的待部署文件树中运行 `node tools/stamp-preview.cjs .`，更新 HTML 引用资源的内容指纹，并以 `node tools/stamp-preview.cjs . --check` 核验。保持纸本元数据和存储键不变。面对公众只分享正式根网址，不使用带临时参数的验收 URL。
