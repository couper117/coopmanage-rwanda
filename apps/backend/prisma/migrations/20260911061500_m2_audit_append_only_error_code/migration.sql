-- The append-only guard created in M2 raised with ERRCODE 'restrict_violation' (23001). Prisma
-- maps every 23xxx state to "Foreign key constraint violated", so an attempt to rewrite history
-- surfaced in the application as a message about a foreign key and said nothing about what had
-- actually been refused.
--
-- Raising on the default P0001 instead carries the real sentence through to whoever hits it. The
-- guard itself is unchanged; only how it reports is.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
