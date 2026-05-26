-- AlterTable
ALTER TABLE "render_jobs" ADD COLUMN     "template_version" INTEGER;

-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "has_unpublished_changes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "published_version" INTEGER;

-- CreateTable
CREATE TABLE "template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" TEXT,
    "restored_from" INTEGER,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_versions_template_id_version_idx" ON "template_versions"("template_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
