-- CreateEnum
CREATE TYPE "assistant_role" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" "assistant_role" NOT NULL,
    "question" TEXT,
    "answer_key" TEXT,
    "answer_params" JSONB,
    "tool" TEXT,
    "tool_args" JSONB,
    "figures" JSONB,
    "data_snapshot" JSONB,
    "href" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_cooperative_id_user_id_updated_at_idx" ON "assistant_conversations"("cooperative_id", "user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_created_at_idx" ON "assistant_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the database keeps.
--
-- The important one is the last: a message is a question or an answer, and an answer carries a
-- translation key rather than prose. A row holding both, or neither, would be a message no screen
-- could render — and a row where an answer had prose but no key would be the one thing this whole
-- module exists to prevent: a sentence nobody can trace to a query.
-- ---------------------------------------------------------------------------

ALTER TABLE "assistant_conversations"
  ADD CONSTRAINT "assistant_conversations_title_not_blank" CHECK (length(btrim("title")) > 0);

ALTER TABLE "assistant_messages"
  -- A question is what somebody typed; an answer is a key and its parameters. Exactly one shape
  -- per row, decided by the role, so nothing can be half a message.
  ADD CONSTRAINT "assistant_messages_shape" CHECK (
    ("role" = 'USER'
      AND length(btrim("question")) > 0
      AND "answer_key" IS NULL
      AND "tool" IS NULL)
    OR ("role" = 'ASSISTANT'
      AND "question" IS NULL
      AND length(btrim("answer_key")) > 0)
  ),
  -- A tool that answered names itself and its arguments together, or neither. A tool with no
  -- arguments recorded could not be re-run to check the figure it produced.
  ADD CONSTRAINT "assistant_messages_tool_has_args" CHECK (
    ("tool" IS NULL AND "tool_args" IS NULL) OR ("tool" IS NOT NULL AND "tool_args" IS NOT NULL)
  );
