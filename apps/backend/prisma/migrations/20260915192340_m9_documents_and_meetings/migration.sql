-- CreateEnum
CREATE TYPE "document_category" AS ENUM ('REGISTRATION', 'FINANCIAL', 'MEMBER', 'CONTRACT', 'CERTIFICATE', 'MEETING_MINUTES', 'REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "document_visibility" AS ENUM ('COOPERATIVE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "meeting_type" AS ENUM ('GENERAL_ASSEMBLY', 'BOARD', 'COMMITTEE', 'EXTRAORDINARY', 'OTHER');

-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "decision_type" AS ENUM ('RESOLUTION', 'ACTION', 'NOTE');

-- CreateEnum
CREATE TYPE "decision_status" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "document_category" NOT NULL DEFAULT 'OTHER',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "visibility" "document_visibility" NOT NULL DEFAULT 'COOPERATIVE',
    "member_id" UUID,
    "meeting_id" UUID,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploaded_by_id" UUID,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_id" UUID,
    "archive_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "meeting_type" NOT NULL DEFAULT 'GENERAL_ASSEMBLY',
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "location" TEXT,
    "status" "meeting_status" NOT NULL DEFAULT 'SCHEDULED',
    "quorum_required" INTEGER,
    "notes" TEXT,
    "minutes_document_id" UUID,
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_agenda_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "presenter_staff_id" UUID,

    CONSTRAINT "meeting_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "member_id" UUID,
    "staff_id" UUID,
    "guest_name" TEXT,
    "status" "attendance_status" NOT NULL DEFAULT 'PRESENT',
    "checked_in_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "agenda_item_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "decision_type" "decision_type" NOT NULL DEFAULT 'RESOLUTION',
    "votes_for" INTEGER,
    "votes_against" INTEGER,
    "abstentions" INTEGER,
    "due_on" DATE,
    "responsible_staff_id" UUID,
    "status" "decision_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_cooperative_id_category_idx" ON "documents"("cooperative_id", "category");

-- CreateIndex
CREATE INDEX "documents_cooperative_id_created_at_idx" ON "documents"("cooperative_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_cooperative_id_is_archived_idx" ON "documents"("cooperative_id", "is_archived");

-- CreateIndex
CREATE INDEX "documents_cooperative_id_member_id_idx" ON "documents"("cooperative_id", "member_id");

-- CreateIndex
CREATE INDEX "documents_cooperative_id_meeting_id_idx" ON "documents"("cooperative_id", "meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_minutes_document_id_key" ON "meetings"("minutes_document_id");

-- CreateIndex
CREATE INDEX "meetings_cooperative_id_scheduled_for_idx" ON "meetings"("cooperative_id", "scheduled_for" DESC);

-- CreateIndex
CREATE INDEX "meetings_cooperative_id_status_idx" ON "meetings"("cooperative_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_cooperative_id_reference_key" ON "meetings"("cooperative_id", "reference");

-- CreateIndex
CREATE INDEX "meeting_agenda_items_meeting_id_idx" ON "meeting_agenda_items"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_agenda_items_meeting_id_position_key" ON "meeting_agenda_items"("meeting_id", "position");

-- CreateIndex
CREATE INDEX "meeting_attendees_meeting_id_idx" ON "meeting_attendees"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_attendees_member_id_idx" ON "meeting_attendees"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendees_meeting_id_member_id_key" ON "meeting_attendees"("meeting_id", "member_id");

-- CreateIndex
CREATE INDEX "meeting_decisions_meeting_id_idx" ON "meeting_decisions"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_decisions_responsible_staff_id_status_idx" ON "meeting_decisions"("responsible_staff_id", "status");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_minutes_document_id_fkey" FOREIGN KEY ("minutes_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_presenter_staff_id_fkey" FOREIGN KEY ("presenter_staff_id") REFERENCES "cooperative_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "cooperative_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "meeting_agenda_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_responsible_staff_id_fkey" FOREIGN KEY ("responsible_staff_id") REFERENCES "cooperative_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express. Each one is a rule this
-- module depends on being true of every row, including rows written by a future
-- migration or by hand at a console.
-- ---------------------------------------------------------------------------

-- A file has a size and it is not negative, and a checksum is a SHA-256: 64 hex characters.
-- A row whose checksum is the wrong shape cannot be compared against anything, which defeats the
-- only reason it is stored.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_size_bytes_positive" CHECK ("size_bytes" > 0);

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_checksum_is_sha256" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$');

-- A storage key is random and has a shape: the application writes `<yyyy>/<mm>/<48 hex>`. Pinning
-- it here stops a key derived from a filename ever reaching the column, which is what would make a
-- document guessable.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_storage_key_shape"
  CHECK ("storage_key" ~ '^[0-9]{4}/[0-9]{2}/[0-9a-f]{48}$');

-- An archived document says when and by whom. An archive nobody can account for is the same
-- problem as a deletion, which is the thing archiving exists to avoid.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_archived_has_actor"
  CHECK (
    "is_archived" = false
    OR ("archived_at" IS NOT NULL AND "archived_by_id" IS NOT NULL)
  );

-- An attendance row names exactly one of a member, a member of staff or a guest. Two would make
-- the quorum count ambiguous and none would make the row meaningless.
ALTER TABLE "meeting_attendees"
  ADD CONSTRAINT "meeting_attendees_exactly_one_subject"
  CHECK (
    (("member_id" IS NOT NULL)::int + ("staff_id" IS NOT NULL)::int + ("guest_name" IS NOT NULL)::int) = 1
  );

-- A guest is a name, not an empty string standing in for one.
ALTER TABLE "meeting_attendees"
  ADD CONSTRAINT "meeting_attendees_guest_name_not_blank"
  CHECK ("guest_name" IS NULL OR length(btrim("guest_name")) > 0);

-- A meeting that ends does so after it starts.
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_ends_after_start"
  CHECK ("ends_at" IS NULL OR "ends_at" > "scheduled_for");

-- Quorum is a number of members, so it is positive where it is set at all.
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_quorum_positive"
  CHECK ("quorum_required" IS NULL OR "quorum_required" > 0);

-- A cancelled meeting says why. "Cancelled" with no reason is a question at the next assembly.
ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_cancelled_has_reason"
  CHECK (
    "status" <> 'CANCELLED'
    OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) > 0)
  );

-- Agenda positions start at one and count up, so the order a cooperative reads is the order stored.
ALTER TABLE "meeting_agenda_items"
  ADD CONSTRAINT "meeting_agenda_items_position_positive" CHECK ("position" >= 1);

-- Votes are counts. A negative vote count is not a disagreement, it is a bug.
ALTER TABLE "meeting_decisions"
  ADD CONSTRAINT "meeting_decisions_votes_not_negative"
  CHECK (
    coalesce("votes_for", 0) >= 0
    AND coalesce("votes_against", 0) >= 0
    AND coalesce("abstentions", 0) >= 0
  );
