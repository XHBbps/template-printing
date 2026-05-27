-- AlterTable
ALTER TABLE "users" ADD COLUMN     "external_code" TEXT,
ADD COLUMN     "mobile" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_external_code_key" ON "users"("external_code");
