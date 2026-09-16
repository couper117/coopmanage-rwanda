-- CreateEnum
CREATE TYPE "announcement_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "announcement_audience" AS ENUM ('ALL_MEMBERS', 'ACTIVE_MEMBERS', 'STAFF');

-- CreateEnum
CREATE TYPE "sms_status" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "title_rw" TEXT,
    "body" TEXT NOT NULL,
    "body_rw" TEXT,
    "audience" "announcement_audience" NOT NULL DEFAULT 'ACTIVE_MEMBERS',
    "status" "announcement_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "archive_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "announcement_id" UUID,
    "member_id" UUID,
    "to_phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "sms_status" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_cooperative_id_status_created_at_idx" ON "announcements"("cooperative_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "announcements_cooperative_id_published_at_idx" ON "announcements"("cooperative_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "sms_messages_cooperative_id_created_at_idx" ON "sms_messages"("cooperative_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sms_messages_announcement_id_idx" ON "sms_messages"("announcement_id");

-- CreateIndex
CREATE INDEX "sms_messages_member_id_idx" ON "sms_messages"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_cooperative_id_dedupe_key_key" ON "sms_messages"("cooperative_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the database keeps, so no code path can write a row that contradicts itself.
--
-- Every one of these is a state a screen would otherwise have to guess its way around: an
-- announcement marked published with no date on it, an archived record with no reason anybody can
-- read, a message marked sent that nothing was ever sent to.
-- ---------------------------------------------------------------------------

-- An announcement says something. A blank title or body is a row nobody can act on.
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "announcements_body_not_blank" CHECK (length(btrim("body")) > 0),
  -- Where a Kinyarwanda version was given it is a real one. An empty string is not a translation.
  ADD CONSTRAINT "announcements_title_rw_not_blank"
    CHECK ("title_rw" IS NULL OR length(btrim("title_rw")) > 0),
  ADD CONSTRAINT "announcements_body_rw_not_blank"
    CHECK ("body_rw" IS NULL OR length(btrim("body_rw")) > 0),
  -- Published means somebody published it, at a time. Both, or neither.
  --
  -- Archived is deliberately outside this rule. A draft can be abandoned and archived without ever
  -- having been published, and the alternative — requiring a publisher on every archived row —
  -- would make the database insist on a lie: the person who archived a draft recorded as having
  -- published something nobody ever sent.
  ADD CONSTRAINT "announcements_published_has_publisher" CHECK (
    ("status" = 'DRAFT' AND "published_at" IS NULL AND "published_by_id" IS NULL)
    OR ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
    OR ("status" = 'ARCHIVED'
        AND (("published_at" IS NULL AND "published_by_id" IS NULL)
             OR ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)))
  ),
  -- Archiving is not deleting, and a cooperative asked later why a notice was withdrawn deserves
  -- an answer that is in the record rather than in somebody's memory.
  ADD CONSTRAINT "announcements_archived_has_reason" CHECK (
    ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL AND length(btrim("archive_reason")) > 0)
    OR ("status" <> 'ARCHIVED' AND "archived_at" IS NULL AND "archive_reason" IS NULL)
  );

-- A message has a destination and something to say, and the number is the canonical form the
-- phone module produces: +250 and nine digits. A provider handed anything else would silently
-- drop it.
ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_to_phone_shape" CHECK ("to_phone" ~ '^\+2507[0-9]{8}$'),
  ADD CONSTRAINT "sms_messages_body_not_blank" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "sms_messages_provider_not_blank" CHECK (length(btrim("provider")) > 0),
  ADD CONSTRAINT "sms_messages_dedupe_key_not_blank" CHECK (length(btrim("dedupe_key")) > 0),
  -- Sent means it left, at a time; failed means there is a reason to read. Neither state can be
  -- half-recorded, because the log is what the cooperative is later asked to stand behind.
  ADD CONSTRAINT "sms_messages_status_consistent" CHECK (
    ("status" = 'QUEUED' AND "sent_at" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'SENT' AND "sent_at" IS NOT NULL AND "failure_reason" IS NULL)
    OR ("status" = 'FAILED' AND length(btrim("failure_reason")) > 0)
  );
