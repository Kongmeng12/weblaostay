-- Puts the work that was already waiting when admin notifications arrived
-- (0019) into the admin bell: partner applications, refunds and review reports
-- still pending. Paid bookings are not backfilled — every past booking at once
-- would bury the few items that need someone to act.
--
-- Needs 0019 (the templates). Safe to run again: each insert skips an admin
-- who already has a notification for that item. Times are the original
-- events', so the bell lists them in the order they happened.

-- Partner applications waiting for approval → every active admin.
INSERT INTO notifications
  (user_id, title, message, notification_type, reference_type, reference_id, created_at)
SELECT a.user_id,
       t.title_template,
       replace(replace(t.message_template, '{{business}}', p.business_name),
               '{{property}}', coalesce(pr.property_name, '—')),
       t.notification_type,
       'partner',
       p.partner_id,
       p.created_at
FROM partners p
CROSS JOIN notification_templates t
JOIN users a ON a.role = 'ADMIN' AND a.status = 'active' AND a.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT property_name FROM properties
  WHERE partner_id = p.partner_id AND deleted_at IS NULL
  ORDER BY property_id
  LIMIT 1
) pr ON true
WHERE t.template_code = 'admin_partner_applied'
  AND p.status = 'pending'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = a.user_id AND n.reference_type = 'partner' AND n.reference_id = p.partner_id
  );

-- Refunds owed to guests → the admins who can send them.
INSERT INTO notifications
  (user_id, title, message, notification_type, reference_type, reference_id, created_at)
SELECT a.user_id,
       t.title_template,
       replace(replace(t.message_template, '{{booking_code}}', b.booking_code),
               '{{amount}}', '₭' || to_char(r.amount, 'FM999,999,999,999,990')),
       t.notification_type,
       'refund',
       r.refund_id,
       r.created_at
FROM refunds r
JOIN bookings b ON b.booking_id = r.booking_id
CROSS JOIN notification_templates t
JOIN users a ON a.role = 'ADMIN' AND a.status = 'active' AND a.deleted_at IS NULL
            AND a.admin_role IN ('super_admin', 'finance')
WHERE t.template_code = 'admin_refund_pending'
  AND r.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = a.user_id AND n.reference_type = 'refund' AND n.reference_id = r.refund_id
  );

-- Reviews with an open report or hide request → every active admin. One per
-- review, worded with its latest report's reason.
INSERT INTO notifications
  (user_id, title, message, notification_type, reference_type, reference_id, created_at)
SELECT a.user_id,
       t.title_template,
       replace(replace(t.message_template, '{{property}}', pr.property_name),
               '{{reason}}', CASE rr.reason
                               WHEN 'spam'      THEN 'ສະແປມ'
                               WHEN 'offensive' THEN 'ຄຳຫຍາບຄາຍ'
                               WHEN 'fake'      THEN 'ຮີວິວປອມ'
                               ELSE 'ອື່ນໆ'
                             END),
       t.notification_type,
       'review',
       rr.review_id,
       rr.created_at
FROM (
  SELECT DISTINCT ON (review_id) review_id, reason, created_at
  FROM review_reports
  WHERE status = 'pending'
  ORDER BY review_id, created_at DESC
) rr
JOIN reviews rv ON rv.review_id = rr.review_id
JOIN properties pr ON pr.property_id = rv.property_id
CROSS JOIN notification_templates t
JOIN users a ON a.role = 'ADMIN' AND a.status = 'active' AND a.deleted_at IS NULL
WHERE t.template_code = 'admin_review_reported'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = a.user_id AND n.reference_type = 'review' AND n.reference_id = rr.review_id
  );
