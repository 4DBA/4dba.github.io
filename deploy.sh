#!/usr/bin/env bash
set -euo pipefail

BLOG_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE="cloud-blog"
REMOTE_DIR="/opt/1panel/www/sites/4dba.top/index"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

cd "$BLOG_DIR"

NO_PUSH=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-push) NO_PUSH=true; shift ;;
        *)         error "未知参数: $1" ;;
    esac
done

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 > /dev/null 2>&1

info "生成静态文件..."
npx hexo generate --force 2>&1 | tail -3

if [[ "$NO_PUSH" == false ]]; then
    info "推送到 ${REMOTE}:${REMOTE_DIR} ..."
    # 用 tar 打包传输，远程先清空旧文件再解压
    tar -C public -cf - . | ssh "${REMOTE}" "rm -rf ${REMOTE_DIR}/* && tar -C ${REMOTE_DIR} -xf -"
    info "部署完成 ✅"
else
    warn "跳过推送 (--no-push)"
fi
