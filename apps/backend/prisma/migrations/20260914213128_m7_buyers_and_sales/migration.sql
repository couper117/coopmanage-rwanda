-- CreateEnum
CREATE TYPE "sale_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- DropIndex
DROP INDEX "products_name_trgm";

-- DropIndex
DROP INDEX "products_sku_trgm";

-- AlterTable
ALTER TABLE "finance_transactions" ADD COLUMN     "buyer_id" UUID,
ADD COLUMN     "sale_id" UUID;

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "buyer_id" UUID,
ADD COLUMN     "sale_id" UUID;

-- CreateTable
CREATE TABLE "buyers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "tin" TEXT,
    "province" TEXT,
    "district" TEXT,
    "sector" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooperative_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "sale_date" DATE NOT NULL,
    "status" "sale_status" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "note" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_id" UUID NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyers_cooperative_id_is_active_idx" ON "buyers"("cooperative_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_cooperative_id_name_key" ON "buyers"("cooperative_id", "name");

-- CreateIndex
CREATE INDEX "sales_cooperative_id_sale_date_idx" ON "sales"("cooperative_id", "sale_date");

-- CreateIndex
CREATE INDEX "sales_cooperative_id_buyer_id_idx" ON "sales"("cooperative_id", "buyer_id");

-- CreateIndex
CREATE INDEX "sales_cooperative_id_payment_status_idx" ON "sales"("cooperative_id", "payment_status");

-- CreateIndex
CREATE INDEX "sales_cooperative_id_status_sale_date_idx" ON "sales"("cooperative_id", "status", "sale_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_cooperative_id_reference_key" ON "sales"("cooperative_id", "reference");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_position_key" ON "sale_items"("sale_id", "position");

-- CreateIndex
CREATE INDEX "finance_transactions_cooperative_id_sale_id_idx" ON "finance_transactions"("cooperative_id", "sale_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_sale_id_idx" ON "inventory_transactions"("sale_id");

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cooperative_id_fkey" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints. A sale is arithmetic somebody will be held to, so
-- the rules live in the database where no code path can go round them.
-- ---------------------------------------------------------------------------

-- Every money column on a sale is a real amount and none of them can be negative. A negative
-- total would mean the cooperative owed the buyer, which is a refund and a different thing.
ALTER TABLE "sales" ADD CONSTRAINT "sales_subtotal_not_negative" CHECK ("subtotal" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_discount_not_negative" CHECK ("discount" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_tax_not_negative" CHECK ("tax_amount" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_total_not_negative" CHECK ("total" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_paid_not_negative" CHECK ("amount_paid" >= 0);

-- A discount cannot exceed what is being discounted. Without this a mistyped discount turns a
-- sale into a negative total and every report that sums sales quietly goes wrong.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_discount_within_subtotal" CHECK ("discount" <= "subtotal");

-- The total is the subtotal less the discount plus the tax, and it is stored so that a report
-- need not recompute it. Storing a derived figure is only safe if the database refuses a row
-- where it disagrees with what it was derived from.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_total_is_derived"
  CHECK ("total" = "subtotal" - "discount" + "tax_amount");

-- A cancelled sale says why, and a confirmed one says when. Neither is optional in practice, and
-- a status that cannot be explained is a status nobody can audit.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_cancelled_has_reason"
  CHECK (
    "status" <> 'CANCELLED'
    OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) > 0 AND "cancelled_at" IS NOT NULL)
  );
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_confirmed_has_time"
  CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL);

-- Payment is only ever recorded against a confirmed sale, so a draft cannot carry one.
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_draft_is_unpaid"
  CHECK ("status" <> 'DRAFT' OR ("amount_paid" = 0 AND "payment_status" = 'UNPAID'));

-- A line is a positive quantity at a price, and its total is the two multiplied. Same reasoning
-- as the sale total: a stored derived figure needs the database to refuse a row that disagrees.
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_price_not_negative" CHECK ("unit_price" >= 0);
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_line_total_is_derived"
  CHECK ("line_total" = round("quantity" * "unit_price", 2));

-- Finding a buyer means typing part of their name, the same way finding a member or a product
-- does.
CREATE INDEX "buyers_name_trgm" ON "buyers" USING gin ("name" gin_trgm_ops);

-- What is still owed, which is the question a treasurer asks of this table.
CREATE INDEX "sales_unpaid"
  ON "sales"("cooperative_id", "sale_date" DESC)
  WHERE "status" = 'CONFIRMED' AND "payment_status" <> 'PAID';
