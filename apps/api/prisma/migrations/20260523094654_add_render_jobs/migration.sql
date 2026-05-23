-- CreateTable
CREATE TABLE "render_jobs" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "formats" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pdf_url" TEXT,
    "png_url" TEXT,
    "error_msg" TEXT,
    "callback_url" TEXT,
    "callback_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "render_jobs_template_id_created_at_idx" ON "render_jobs"("template_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "render_jobs_status_created_at_idx" ON "render_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
