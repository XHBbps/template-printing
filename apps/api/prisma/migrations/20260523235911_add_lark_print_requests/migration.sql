-- CreateTable
CREATE TABLE "lark_print_requests" (
    "id" TEXT NOT NULL,
    "render_job_id" TEXT NOT NULL,
    "app_token" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "status_field" TEXT NOT NULL,
    "attachment_field" TEXT NOT NULL,
    "callback_status" TEXT,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lark_print_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lark_print_requests_render_job_id_key" ON "lark_print_requests"("render_job_id");

-- CreateIndex
CREATE INDEX "lark_print_requests_render_job_id_idx" ON "lark_print_requests"("render_job_id");

-- AddForeignKey
ALTER TABLE "lark_print_requests" ADD CONSTRAINT "lark_print_requests_render_job_id_fkey" FOREIGN KEY ("render_job_id") REFERENCES "render_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
