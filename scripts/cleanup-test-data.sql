-- Removes the test companies, users and admins created while building and testing RegRadar,
-- so the admin console only shows real usage. Real accounts (any email not ending in
-- @example.com or @demobank.example) and the regulator circulars are kept.
--
-- Run it (from the project folder):
--   docker exec -i regradar-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/cleanup-test-data.sql
--
-- Everything runs in one transaction: either all of it happens or none of it does.
BEGIN;

-- Test companies = companies with no real user. Deleting a company also deletes its users,
-- chats, conversations, policies, private regulations, impact findings, invites, alert
-- settings and audit log (the database cascades these).
CREATE TEMP TABLE test_orgs AS
  SELECT o.id FROM organizations o
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id
                    AND u.email NOT LIKE '%@example.com' AND u.email NOT LIKE '%@demobank.example');
SELECT count(*) AS test_companies_removed FROM test_orgs;
DELETE FROM organizations WHERE id IN (SELECT id FROM test_orgs);

-- Test platform admins, and admin-log entries that don't belong to a real admin.
DELETE FROM admin_audit a WHERE a.admin_id IS NULL
   OR a.admin_id IN (SELECT id FROM platform_admins WHERE email LIKE '%@example.com');
DELETE FROM platform_admins WHERE email LIKE '%@example.com';

-- What remains
SELECT (SELECT count(*) FROM organizations) AS companies, (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM platform_admins) AS admins, (SELECT count(*) FROM documents WHERE org_id IS NULL) AS regulator_circulars;
SELECT o.name AS company, u.email, u.role FROM users u JOIN organizations o ON o.id = u.org_id ORDER BY u.created_at;

COMMIT;
