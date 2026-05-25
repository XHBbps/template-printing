-- AlterTable
ALTER TABLE "render_jobs" ADD COLUMN     "attempts_made" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "cleaned_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "render_jobs_cleaned_at_created_at_idx" ON "render_jobs"("cleaned_at", "created_at");
