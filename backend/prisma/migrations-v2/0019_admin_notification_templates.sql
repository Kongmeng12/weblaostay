-- Notifications for admins — the bell in the WebAdmin header. Sent by
-- NotificationsService.sendToAdmins(); each one opens the admin screen where
-- the work is (approvals, refunds, reviews, bookings).
INSERT INTO notification_templates
  (template_code, title_template, message_template, notification_type) VALUES
  ('admin_partner_applied', 'ມີໃບສະໝັກ Partner ໃໝ່',
   '{{business}} · {{property}}', 'system'),
  ('admin_refund_pending',  'ມີເງິນຕ້ອງຄືນລູກຄ້າ',
   '{{booking_code}} · {{amount}}', 'payment'),
  ('admin_review_reported', 'ມີການລາຍງານຮີວິວ',
   '{{property}} · {{reason}}', 'review'),
  ('admin_booking_paid',    'ມີການຈອງໃໝ່ ຊຳລະແລ້ວ',
   '{{booking_code}} · {{amount}} · {{property}}', 'booking')
ON CONFLICT (template_code) DO NOTHING;
