-- LaoStay · schema v2 — make "ຫຼັກ · Main" the policy every property uses
--
-- 0007 only filled in properties that had never picked a policy
-- (`cancellation_policy_id IS NULL`) — every property that already had
-- Flexible/Moderate/Strict/Non-refundable explicitly assigned kept it, so a
-- guest cancelling on one of those still saw the old terms. This is the
-- follow-up that actually makes it the platform's one cancellation policy:
-- every property is switched to it, not just the ones with nothing set.
--
-- `partner.service.ts` can still assign a different `cancellationPolicyId`
-- to a property going forward if that ever becomes a real per-partner
-- choice — this is a one-time data correction, not a code-level lock to
-- "ຫຼັກ · Main" only.
--
-- Idempotent: re-running just re-sets everyone to the same policy.

BEGIN;

UPDATE properties
SET cancellation_policy_id = (
  SELECT cancellation_policy_id FROM cancellation_policies WHERE policy_name = 'ຫຼັກ · Main'
)
WHERE cancellation_policy_id IS DISTINCT FROM (
  SELECT cancellation_policy_id FROM cancellation_policies WHERE policy_name = 'ຫຼັກ · Main'
);

COMMIT;
