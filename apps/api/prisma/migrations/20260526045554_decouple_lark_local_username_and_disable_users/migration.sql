-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabled_at" TIMESTAMP(3);

-- 解耦：飞书自动建号曾写 local_username=user_id；仅清理"无本地密码且是飞书账号"的历史 dev 数据，绝不动有本地密码的用户
UPDATE "users" SET "local_username" = NULL
WHERE "local_password_hash" IS NULL AND "lark_open_id" IS NOT NULL;
