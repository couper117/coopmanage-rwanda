-- The constraints that belong with `report_runs`, added as their own migration because the table
-- was already applied. Additive and separate, which is the rule in `database.md` section 14: a
-- migration that has run is never edited.

-- A failed run says why, and a finished one says when it finished. A status that cannot be
-- explained is a run nobody can account for, which is the whole reason this table exists.
ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_failed_has_reason"
  CHECK (
    "status" <> 'FAILED'
    OR ("error_message" IS NOT NULL AND length(btrim("error_message")) > 0)
  );

ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_ready_has_time"
  CHECK ("status" <> 'READY' OR "completed_at" IS NOT NULL);

-- A row count is a count.
ALTER TABLE "report_runs"
  ADD CONSTRAINT "report_runs_row_count_not_negative"
  CHECK ("row_count" IS NULL OR "row_count" >= 0);
