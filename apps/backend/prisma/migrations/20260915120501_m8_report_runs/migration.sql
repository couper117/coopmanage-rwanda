-- CreateEnum
CREATE TYPE "report_format" AS ENUM ('PDF', 'CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('PENDING', 'READY', 'FAILED');

-- DropIndex
DROP INDEX "buyers_name_trgm";

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "format" "report_format" NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'PENDING',
    "storage_key" TEXT,
    "error_message" TEXT,
    "row_count" INTEGER,
    "generated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_runs_cooperative_id_created_at_idx" ON "report_runs"("cooperative_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "report_runs_cooperative_id_type_created_at_idx" ON "report_runs"("cooperative_id", "type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
