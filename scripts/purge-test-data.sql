-- Removes every account on the test email domain and any cooperative left with no staff.
--
-- The integration suite runs against a real PostgreSQL, and by default that is the development
-- database. Its own teardown removes what it created, but a run that is interrupted, or a version
-- of the teardown that missed a path, leaves rows behind. Those accumulate until a list screen in
-- development is mostly test data.
--
-- Safe by construction: it only ever touches addresses ending in @example.test, which nothing real
-- uses, and cooperatives that have no staff at all and are not the demonstration cooperative.
--
-- Run with: npm run db:purge-test-data

BEGIN;

-- The trail is append-only in every other context. Switching the trigger off here is deliberate
-- and scoped to this transaction; audit.test.ts asserts the trigger is active in normal operation.
ALTER TABLE audit_log DISABLE TRIGGER USER;

CREATE TEMP TABLE stray_users ON COMMIT DROP AS
SELECT id FROM users WHERE email LIKE '%@example.test';

DELETE FROM staff_permission_overrides
WHERE staff_id IN (SELECT id FROM cooperative_staff WHERE user_id IN (SELECT id FROM stray_users));

UPDATE cooperative_staff SET invited_by_id = NULL
WHERE invited_by_id IN (SELECT id FROM stray_users);

DELETE FROM cooperative_staff WHERE user_id IN (SELECT id FROM stray_users);
DELETE FROM refresh_sessions WHERE user_id IN (SELECT id FROM stray_users);
DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM stray_users);

UPDATE system_settings SET updated_by_id = NULL
WHERE updated_by_id IN (SELECT id FROM stray_users);
UPDATE cooperative_settings SET updated_by_id = NULL
WHERE updated_by_id IN (SELECT id FROM stray_users);

DELETE FROM audit_log
WHERE actor_user_id IN (SELECT id FROM stray_users)
   OR entity_id IN (SELECT id::text FROM stray_users);

DELETE FROM users WHERE id IN (SELECT id FROM stray_users);

-- A cooperative nobody works at is a leftover from a test that created one and then removed its
-- staff. The demonstration cooperative is never touched.
CREATE TEMP TABLE stray_cooperatives ON COMMIT DROP AS
SELECT c.id
FROM cooperatives c
WHERE c.is_demo = false
  AND NOT EXISTS (SELECT 1 FROM cooperative_staff s WHERE s.cooperative_id = c.id);

DELETE FROM audit_log WHERE cooperative_id IN (SELECT id FROM stray_cooperatives);
DELETE FROM cooperative_settings WHERE cooperative_id IN (SELECT id FROM stray_cooperatives);
DELETE FROM units_of_measure WHERE cooperative_id IN (SELECT id FROM stray_cooperatives);
DELETE FROM cooperatives WHERE id IN (SELECT id FROM stray_cooperatives);

ALTER TABLE audit_log ENABLE TRIGGER USER;

COMMIT;

SELECT
  (SELECT count(*) FROM users) AS users_remaining,
  (SELECT count(*) FROM users WHERE email LIKE '%@example.test') AS test_users_remaining,
  (SELECT count(*) FROM cooperatives) AS cooperatives_remaining;
