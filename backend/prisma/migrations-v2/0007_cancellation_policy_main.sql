-- LaoStay · schema v2 — the platform default cancellation policy
--
-- The four policies 0004 seeds (Flexible/Moderate/Strict/Non-refundable) are
-- all opt-in: a property with none picked has `cancellation_policy_id NULL`,
-- and `policyIdFor()` in booking.service.ts used to leave it NULL — which
-- meant unlimited free cancellation with no deadline, for every property
-- whose partner never visited that setting. This is the fallback that closes
-- that gap: 90% refund up to 24 hours before check-in, no cancellation after.
--
-- `policyIdFor()` looks this row up by name at booking time — see
-- MAIN_POLICY_NAME in booking.service.ts. Idempotent: safe to re-run.

BEGIN;

INSERT INTO cancellation_policies
  (policy_name, days_before_checkin, penalty_percent, is_refundable, description)
SELECT 'ຫຼັກ · Main', 1, 10.00, true,
  'ຍົກເລີກກ່ອນເຂົ້າພັກ 24 ຊົ່ວໂມງ ຄືນເງິນ 90% · ຫຼັງຈາກນັ້ນຍົກເລີກບໍ່ໄດ້'
WHERE NOT EXISTS (
  SELECT 1 FROM cancellation_policies WHERE policy_name = 'ຫຼັກ · Main'
);

-- Only properties with no explicit choice — never touches one a partner
-- deliberately set, even if it happens to be a different policy.
UPDATE properties
SET cancellation_policy_id = (
  SELECT cancellation_policy_id FROM cancellation_policies WHERE policy_name = 'ຫຼັກ · Main'
)
WHERE cancellation_policy_id IS NULL;

COMMIT;
