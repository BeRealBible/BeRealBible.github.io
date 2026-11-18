# 当前测试入口（固定）
手机、桌面和已保存书签都使用 `https://xxmm1221.github.io/paper-bible-demo/?v=index-25`。除非产品负责人明确改变发布策略，不新增面向用户的版本号，不更换入口地址，不因更新清空阅读位置、历史或高亮。
在干净的待部署文件树中运行 `node tools/stamp-preview.cjs .`，仅为 HTML 引用的 JS/CSS 更新内容指纹，用于缓存失效；以 `node tools/stamp-preview.cjs . --check` 核验。保持现有发布分支。通过同一入口确认发布后再交付，不拿带随机参数的测试地址当新链接。
