#!/usr/bin/env bash
set -euo pipefail

# Hexo 新建文章脚本
# 用法: ./new.sh "文章标题" [分类]

BLOG_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BLOG_DIR"

GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[✓]${NC} $*"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

TITLE="${1:?用法: ./new.sh \"文章标题\" [分类]}"
CATEGORY="${2:-}"

npx hexo new "$TITLE" > /dev/null 2>&1

# 获取生成的文件路径
FILE=$(find source/_posts -name "*.md" -newer .hexo-last-new 2>/dev/null | head -1 || true)
if [[ -z "$FILE" ]]; then
    # fallback: 最新的 md 文件
    FILE=$(ls -t source/_posts/*.md 2>/dev/null | head -1)
fi
touch .hexo-last-new

# 如果指定了分类，写入 frontmatter
if [[ -n "$CATEGORY" ]]; then
    sed -i "s/^categories:$/categories: $CATEGORY/" "$FILE"
    # 确保分类目录存在
    mkdir -p "source/_posts/$CATEGORY"
    mv "$FILE" "source/_posts/$CATEGORY/"
    FILE="source/_posts/$CATEGORY/$(basename "$FILE")"
fi

info "已创建: $FILE"
echo "$FILE"
