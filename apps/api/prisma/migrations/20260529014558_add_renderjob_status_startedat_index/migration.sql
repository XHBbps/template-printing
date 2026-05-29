-- CreateIndex
CREATE INDEX "render_jobs_status_started_at_idx" ON "render_jobs"("status", "started_at");
