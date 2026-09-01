-- Notification sent when checkout-sweeper.service.ts auto-completes a
-- booking, prompting the guest to leave a review.
INSERT INTO notification_templates
  (template_code, title_template, message_template, notification_type) VALUES
  ('stay_completed_review_prompt', 'ພັກຂອງທ່ານສຳເລັດແລ້ວ',
   'ການພັກຢູ່ {{property}} ຈົບແລ້ວ · ໃຫ້ຄະແນນປະສົບການຂອງທ່ານ', 'review')
ON CONFLICT (template_code) DO NOTHING;
