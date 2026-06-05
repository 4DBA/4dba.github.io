#!/usr/bin/env bash
set -euo pipefail

BLOG_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

cd "$BLOG_DIR"

# 检查是否有改动
if git diff --quiet && git diff --cached --quiet; then
    warn "没有改动，跳过推送"
    exit 0
fi

# 提交
info "提交改动..."
git add -A
CHANGES=$(git diff --cached --numstat | wc -l)
git commit -m "Update articles ($(date '+%Y-%m-%d %H:%M'))" 2>&1 | tail -3

# 推送（带重试）
info "推送到 GitHub..."
for i in 1 2 3; do
    if git config --global http.postBuffer 524288000 && git push 2>&1; then
        info "推送成功 ✅"
        exit 0
    fi
    warn "第 ${i} 次推送失败，重试..."
    sleep 5
done

error "推送失败，请检查网络"
