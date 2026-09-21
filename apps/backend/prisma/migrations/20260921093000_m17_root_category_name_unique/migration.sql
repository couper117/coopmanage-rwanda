-- A product category's name is unique among its siblings: (cooperative_id, name, parent_id).
-- For a category at the root, parent_id is NULL, and SQL treats every NULL as distinct from every
-- other, so the unique index never fired for two root categories of the same name and a
-- cooperative could file "Grains" twice. Found by the Phase 17 endpoint pass.
--
-- A second, partial index covers the root level. Prisma does not model partial indexes, so it is
-- written here by hand, the way the check constraints on sales are, and schema.prisma carries a
-- comment pointing at it.
CREATE UNIQUE INDEX "product_categories_root_name_key"
  ON "product_categories" ("cooperative_id", "name")
  WHERE "parent_id" IS NULL;
