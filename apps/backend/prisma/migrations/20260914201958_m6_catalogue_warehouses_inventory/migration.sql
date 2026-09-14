-- CreateEnum
CREATE TYPE "product_type" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "inventory_transaction_type" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_OUT', 'SALE_RETURN', 'OPENING');

-- CreateEnum
CREATE TYPE "inventory_direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('LOW_STOCK', 'MEETING_REMINDER', 'REPORT_READY', 'MEMBER_INCOMPLETE', 'DOCUMENT', 'TASK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "notification_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- DropIndex
DROP INDEX "members_code_trgm";

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_rw" TEXT,
    "parent_id" UUID,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_rw" TEXT,
    "category_id" UUID,
    "unit_id" UUID NOT NULL,
    "type" "product_type" NOT NULL DEFAULT 'GOODS',
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "min_stock_level" DECIMAL(14,3),
    "default_purchase_price" DECIMAL(14,2),
    "default_sale_price" DECIMAL(14,2),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "district" TEXT,
    "sector" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "inventory_transaction_type" NOT NULL,
    "direction" "inventory_direction" NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "total_cost" DECIMAL(14,2),
    "source_member_id" UUID,
    "counterparty_transaction_id" UUID,
    "reversal_of_id" UUID,
    "reason" TEXT,
    "note" TEXT,
    "finance_transaction_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "notification_type" NOT NULL,
    "severity" "notification_severity" NOT NULL DEFAULT 'INFO',
    "message_key" TEXT NOT NULL,
    "message_params" JSONB,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "action_url" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_cooperative_id_is_active_idx" ON "product_categories"("cooperative_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_cooperative_id_name_parent_id_key" ON "product_categories"("cooperative_id", "name", "parent_id");

-- CreateIndex
CREATE INDEX "products_cooperative_id_is_active_idx" ON "products"("cooperative_id", "is_active");

-- CreateIndex
CREATE INDEX "products_cooperative_id_category_id_idx" ON "products"("cooperative_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_cooperative_id_sku_key" ON "products"("cooperative_id", "sku");

-- CreateIndex
CREATE INDEX "warehouses_cooperative_id_is_active_idx" ON "warehouses"("cooperative_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_cooperative_id_code_key" ON "warehouses"("cooperative_id", "code");

-- CreateIndex
CREATE INDEX "stock_levels_cooperative_id_quantity_idx" ON "stock_levels"("cooperative_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_product_id_warehouse_id_key" ON "stock_levels"("product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_counterparty_transaction_id_key" ON "inventory_transactions"("counterparty_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_reversal_of_id_key" ON "inventory_transactions"("reversal_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_finance_transaction_id_key" ON "inventory_transactions"("finance_transaction_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_cooperative_id_occurred_at_idx" ON "inventory_transactions"("cooperative_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_product_id_occurred_at_idx" ON "inventory_transactions"("product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_cooperative_id_source_member_id_idx" ON "inventory_transactions"("cooperative_id", "source_member_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_cooperative_id_warehouse_id_occurred_idx" ON "inventory_transactions"("cooperative_id", "warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_cooperative_id_type_occurred_at_idx" ON "inventory_transactions"("cooperative_id", "type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_cooperative_id_reference_key" ON "inventory_transactions"("cooperative_id", "reference");

-- CreateIndex
CREATE INDEX "notifications_cooperative_id_user_id_read_at_idx" ON "notifications"("cooperative_id", "user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_cooperative_id_created_at_idx" ON "notifications"("cooperative_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_cooperative_id_dedupe_key_key" ON "notifications"("cooperative_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_source_member_id_fkey" FOREIGN KEY ("source_member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_counterparty_transaction_id_fkey" FOREIGN KEY ("counterparty_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_finance_transaction_id_fkey" FOREIGN KEY ("finance_transaction_id") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints. Prisma expresses shape; these express the rules,
-- and they belong in the database because that is the one place no code path
-- can go round.
-- ---------------------------------------------------------------------------

-- A quantity is always positive, and the direction lives in its own column. A negative movement
-- would make every sum over this table depend on knowing which types mean "out".
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_quantity_positive" CHECK ("quantity" > 0);

-- A cost is never negative. Zero is allowed: produce delivered by a member before the price is
-- agreed genuinely has no cost yet.
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_unit_cost_not_negative"
  CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_total_cost_not_negative"
  CHECK ("total_cost" IS NULL OR "total_cost" >= 0);

-- An adjustment is a count that disagreed with the record, so it has to say why. Without this the
-- history fills with unexplained corrections and nobody can audit a shortfall.
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_adjustment_has_reason"
  CHECK ("type" <> 'ADJUSTMENT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));

-- Nothing reverses or pairs with itself.
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_reversal_not_self" CHECK ("reversal_of_id" <> "id");
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_counterparty_not_self"
  CHECK ("counterparty_transaction_id" <> "id");

-- Stock never goes below nothing. The application refuses an over-issue with a conditional update
-- and an INSUFFICIENT_STOCK error; this is what catches a path that forgets to.
ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_quantity_not_negative" CHECK ("quantity" >= 0);

-- A minimum below which the low-stock scan warns. A negative one would warn forever.
ALTER TABLE "products"
  ADD CONSTRAINT "products_min_stock_not_negative"
  CHECK ("min_stock_level" IS NULL OR "min_stock_level" >= 0);
ALTER TABLE "products"
  ADD CONSTRAINT "products_purchase_price_not_negative"
  CHECK ("default_purchase_price" IS NULL OR "default_purchase_price" >= 0);
ALTER TABLE "products"
  ADD CONSTRAINT "products_sale_price_not_negative"
  CHECK ("default_sale_price" IS NULL OR "default_sale_price" >= 0);

-- A service is not counted, so it must not carry a stock minimum that could never be met.
ALTER TABLE "products"
  ADD CONSTRAINT "products_untracked_has_no_minimum"
  CHECK ("track_inventory" OR "min_stock_level" IS NULL);

-- A category cannot be its own parent.
ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_parent_not_self" CHECK ("parent_id" <> "id");

-- Exactly one default warehouse per cooperative. A plain unique on (cooperative_id, is_default)
-- would allow only one non-default warehouse as well, which is the opposite of what is wanted.
CREATE UNIQUE INDEX "warehouses_one_default_per_cooperative"
  ON "warehouses"("cooperative_id")
  WHERE "is_default";

-- Finding a product means typing part of its name or its code, the same way finding a member does.
CREATE INDEX "products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX "products_sku_trgm" ON "products" USING gin ("sku" gin_trgm_ops);

-- The low-stock scan reads only the products that ask to be watched, and only the levels that
-- could be below one. A partial index keeps that scan off the rest of the catalogue.
CREATE INDEX "products_watched_minimum"
  ON "products"("cooperative_id", "min_stock_level")
  WHERE "min_stock_level" IS NOT NULL AND "is_active" AND "track_inventory";

-- Unread notifications for a cooperative, which is what the notification centre asks for.
CREATE INDEX "notifications_unread"
  ON "notifications"("cooperative_id", "created_at" DESC)
  WHERE "read_at" IS NULL AND "dismissed_at" IS NULL;
