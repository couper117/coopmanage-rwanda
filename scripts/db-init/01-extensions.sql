-- Extensions the schema depends on.
-- citext   : case-insensitive email addresses
-- pg_trgm  : trigram indexes for member, product and buyer search
-- pgcrypto : gen_random_uuid() for primary keys
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
