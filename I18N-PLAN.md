# Hexo 博客中英文双语方案

## 目标
- 中文用户看到中文（默认，`/` 路径）
- 英文用户看到英文（`/en/` 路径）
- 浏览器语言自动检测 + 手动切换
- 不改 Hexo/NexT 源码，纯配置+插件+JS

## 当前状态
- Hexo 7.1.1 + NexT Gemini
- 35 篇中文文章，无英文版
- `language: zh-CN`（单语言）
- `language_switcher: false`
- 已有 `source/_data/head.njk`

---

## Phase 1: 基础设施（配置+插件）

### 1.1 安装 i18n 插件
```bash
cd ~/project/blog
source ~/.nvm/nvm.sh && nvm use 22 > /dev/null 2>&1
pnpm add hexo-generator-i18n --registry=https://registry.npmmirror.com
```

### 1.2 修改 `_config.yml`
```yaml
# 改 language 为数组（第一个是默认语言）
language:
  - zh-CN
  - en
```

### 1.3 修改 `_config.next.yml`
```yaml
# 开启页脚语言切换器
language_switcher: true
```

### 1.4 创建英文文章目录
```
source/_posts/en/
├── oracle/
├── mysql/
├── postgresql/
├── xinchuang/
└── ops/
```

---

## Phase 2: 英文文章（AI 批量翻译）

### 2.1 翻译策略
- 每篇中文文章 → 对应英文版放 `source/_posts/en/`
- 英文版 front-matter 加 `lang: en`
- 目录结构保持一致
- 技术术语保留原文（如 Oracle RAC、ASM、DataGuard）

### 2.2 英文文章 front-matter 模板
```yaml
---
title: "RAC + ASM on Multipath Storage: Complete Guide"
date: 2026-01-26 10:00:00
categories: Oracle
tags: [RAC, ASM, Multipath, Storage, Redundancy]
lang: en
---
```

### 2.3 批量翻译方式
用 Hermes AI 逐篇翻译，保持：
- 代码块原样不动
- 技术术语保留英文
- 图片路径一致（共用 `source/images/`）
- 章节结构对应

---

## Phase 3: 自动语言检测

### 3.1 在 `source/_data/head.njk` 添加 JS
```html
<script>
(function() {
  // 已在英文页面或用户手动切换过，不干预
  if (window.location.pathname.startsWith('/en/')) return;
  var saved = localStorage.getItem('lang-preference');
  if (saved) {
    if (saved === 'en') window.location.href = '/en' + window.location.pathname;
    return;
  }
  // 检测浏览器语言
  var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  if (lang && !lang.startsWith('zh')) {
    localStorage.setItem('lang-preference', 'en');
    window.location.href = '/en' + window.location.pathname;
  }
})();
</script>
```

### 3.2 页脚切换器逻辑
NexT 自带的 `language_switcher` 会在页脚生成语言链接，点击后：
- 中文：跳转到 `/当前路径`
- English：跳转到 `/en/当前路径`
- 同时写 `localStorage` 记住选择

---

## Phase 4: 验证+部署

### 4.1 本地验证
```bash
cd ~/project/blog
rm -rf db.json public/
npx hexo generate --force
npx hexo server -p 4000
```

验证清单：
- [ ] `http://localhost:4000/` 显示中文
- [ ] `http://localhost:4000/en/` 显示英文
- [ ] 菜单、侧边栏、页脚文字正确切换
- [ ] 中文文章内容正确
- [ ] 英文文章内容正确
- [ ] 页脚语言切换器可用
- [ ] 非中文浏览器自动跳转 `/en/`

### 4.2 部署
```bash
./deploy2github.sh  # git push → GitHub Actions 自动部署
```

---

## 后续维护

### 新文章流程
1. 写中文文章 → 放 `source/_posts/分类/`
2. AI 翻译英文版 → 放 `source/_posts/en/分类/`
3. `./deploy2github.sh`

### 工作量估算
- Phase 1: 10 分钟（改配置）
- Phase 2: ~2 小时（35 篇文章 AI 翻译）
- Phase 3: 5 分钟（加 JS）
- Phase 4: 10 分钟（验证+部署）
- **总计：约 2.5 小时**
