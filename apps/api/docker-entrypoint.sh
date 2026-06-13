#!/bin/sh
# api 容器入口:启动 node 前修好共享 /storage 卷的归属。
#
# 背景:Pharos 共享命名卷默认 root:root 755。render 容器跑非 root(uid 100:101),
# 直接 mkdir/写 /storage/uploads → EACCES。api 跑 root 且先于 render 健康启动
# (render depends_on api:service_healthy),在此预建目录并把卷归属交给 render,
# render 起来即可写。全新卷自愈,与 Prisma migrate 自动化同思路。
#
# api(root)归属变更后仍能读写(root 无视 owner);render(100)成为 owner 能写产物。
set -e

STORAGE_DIR="${STORAGE_ROOT:-/storage}"
mkdir -p "$STORAGE_DIR/uploads/render"

# 仅当顶层归属还不是 render(100) 时才递归 chown:全新卷/首启一次性修;
# 已修过的卷(顶层=100)跳过,避免每次启动对积累的渲染产物做全量 chown -R 拖慢启动、卡健康门。
if [ "$(stat -c '%u' "$STORAGE_DIR" 2>/dev/null || echo 0)" != "100" ]; then
  echo "[entrypoint] chown -R 100:101 $STORAGE_DIR (首次/全新卷)"
  chown -R 100:101 "$STORAGE_DIR"
else
  # 顶层已对,只保证刚建的 uploads/render 子目录归属正确(非递归,秒过)。
  chown 100:101 "$STORAGE_DIR/uploads" "$STORAGE_DIR/uploads/render"
fi

exec "$@"
