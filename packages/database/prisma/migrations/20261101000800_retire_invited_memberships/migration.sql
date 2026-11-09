-- Task 04B (docs/decisions.md D-04B-03): pending invitations move to their own table, and the
-- next migration removes the INVITED membership status. An INVITED membership never granted
-- access, so existing ones become SUSPENDED (still no access) before the type changes.
UPDATE "memberships" SET "status" = 'SUSPENDED' WHERE "status" = 'INVITED';
