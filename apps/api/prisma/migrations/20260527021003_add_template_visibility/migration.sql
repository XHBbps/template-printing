-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE INDEX "templates_visibility_updated_at_idx" ON "templates"("visibility", "updated_at" DESC);
