-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "MemberPosition" AS ENUM ('MEMBER', 'COMMITTEE', 'SECRETARY', 'TREASURER', 'VICE_CHAIR', 'CHAIRPERSON');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "ShareTransactionType" AS ENUM ('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REDEMPTION');

-- CreateEnum
CREATE TYPE "ContributionType" AS ENUM ('MEMBERSHIP_FEE', 'SAVINGS', 'SHARE_CAPITAL', 'SPECIAL_LEVY', 'PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceSourceType" AS ENUM ('MANUAL', 'SALE', 'CONTRIBUTION', 'SHARE_PURCHASE', 'MEMBER_PAYMENT', 'STOCK_PURCHASE');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "member_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "date_of_birth" DATE,
    "national_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "province" TEXT,
    "district" TEXT,
    "sector" TEXT,
    "cell" TEXT,
    "village" TEXT,
    "joined_on" DATE NOT NULL,
    "position" "MemberPosition" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "exited_on" DATE,
    "exit_reason" TEXT,
    "photo_url" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "type" "ShareTransactionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_value" DECIMAL(14,2) NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL,
    "issued_on" DATE NOT NULL,
    "certificate_no" TEXT,
    "finance_transaction_id" UUID,
    "counterparty_member_id" UUID,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "member_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "type" "ContributionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "finance_transaction_id" UUID,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "name_rw" TEXT,
    "code" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "occurred_at" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" "FinanceSourceType" NOT NULL DEFAULT 'MANUAL',
    "member_id" UUID,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversal_of_id" UUID,
    "void_reason" TEXT,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_cooperative_id_status_idx" ON "members"("cooperative_id", "status");

-- CreateIndex
CREATE INDEX "members_cooperative_id_last_name_first_name_idx" ON "members"("cooperative_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "members_cooperative_id_joined_on_idx" ON "members"("cooperative_id", "joined_on");

-- CreateIndex
CREATE UNIQUE INDEX "members_cooperative_id_member_code_key" ON "members"("cooperative_id", "member_code");

-- CreateIndex
CREATE UNIQUE INDEX "member_shares_finance_transaction_id_key" ON "member_shares"("finance_transaction_id");

-- CreateIndex
CREATE INDEX "member_shares_cooperative_id_member_id_idx" ON "member_shares"("cooperative_id", "member_id");

-- CreateIndex
CREATE INDEX "member_shares_cooperative_id_issued_on_idx" ON "member_shares"("cooperative_id", "issued_on");

-- CreateIndex
CREATE INDEX "member_shares_counterparty_member_id_idx" ON "member_shares"("counterparty_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_finance_transaction_id_key" ON "contributions"("finance_transaction_id");

-- CreateIndex
CREATE INDEX "contributions_cooperative_id_member_id_paid_on_idx" ON "contributions"("cooperative_id", "member_id", "paid_on");

-- CreateIndex
CREATE INDEX "contributions_cooperative_id_paid_on_idx" ON "contributions"("cooperative_id", "paid_on");

-- CreateIndex
CREATE INDEX "finance_categories_cooperative_id_kind_is_active_idx" ON "finance_categories"("cooperative_id", "kind", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_cooperative_id_kind_name_key" ON "finance_categories"("cooperative_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_reversal_of_id_key" ON "finance_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_occurred_at_idx" ON "finance_transactions"("cooperative_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_kind_occurred_at_idx" ON "finance_transactions"("cooperative_id", "kind", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_category_id_occurred_at_idx" ON "finance_transactions"("cooperative_id", "category_id", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_status_occurred_at_idx" ON "finance_transactions"("cooperative_id", "status", "occurred_at");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_member_id_idx" ON "finance_transactions"("cooperative_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_cooperative_id_reference_key" ON "finance_transactions"("cooperative_id", "reference");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_cooperative_id_key_key" ON "idempotency_keys"("cooperative_id", "key");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_counterparty_member_id_fkey" FOREIGN KEY ("counterparty_member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_finance_transaction_id_fkey" FOREIGN KEY ("finance_transaction_id") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_shares" ADD CONSTRAINT "member_shares_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_finance_transaction_id_fkey" FOREIGN KEY ("finance_transaction_id") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- What Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- An amount is always positive; direction lives in `kind`, never in the sign. Enforced by the
-- database so no code path, and no mistake, can post a negative amount into the ledger.
ALTER TABLE "finance_transactions"
  ADD CONSTRAINT "finance_transactions_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "contributions"
  ADD CONSTRAINT "contributions_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "member_shares"
  ADD CONSTRAINT "member_shares_quantity_positive" CHECK ("quantity" > 0);

-- A national identity number is unique within a cooperative, but only when one was given. A
-- partial index is the only way to say that: a plain unique constraint would let two members share
-- a NULL in some databases and forbid a second unknown in others.
CREATE UNIQUE INDEX "members_cooperative_national_id_key"
  ON "members" ("cooperative_id", "national_id")
  WHERE "national_id" IS NOT NULL;

-- Search. A cooperative secretary types part of a name, part of a code, or the last digits of a
-- phone number, and expects the member back immediately. Trigram indexes serve all three, and
-- they are what keeps the exit criterion of 120 members filtering in under 300ms true when the
-- cooperative has grown to several thousand.
CREATE INDEX "members_name_trgm" ON "members"
  USING gin (lower("first_name" || ' ' || "last_name") gin_trgm_ops);

CREATE INDEX "members_code_trgm" ON "members" USING gin ("member_code" gin_trgm_ops);

CREATE INDEX "members_phone_trgm" ON "members" USING gin ("phone" gin_trgm_ops)
  WHERE "phone" IS NOT NULL;

-- A reversal points at exactly one original, and an original is reversed at most once. The unique
-- index Prisma generates covers the second half; this makes a row pointing at itself impossible.
ALTER TABLE "finance_transactions"
  ADD CONSTRAINT "finance_transactions_reversal_not_self" CHECK ("reversal_of_id" <> "id");
