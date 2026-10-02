-- The guest now picks how to pay: a bank (whose own QR PhaJay mints) or a
-- card (PhaJay's hosted 3-D Secure page).
--
--   channel       bcel · jdb · ldb · ib · stb · m_money · card
--   redirect_url  the bank app's deep link, or the card page. Kept because a
--                 guest who comes back to a live QR needs it again — on the
--                 phone they are holding, the QR is the one thing they cannot
--                 scan.
--
-- Both nullable: every payment before this was a BCEL QR with no stored link.
-- Additive only, so a server still running the previous build keeps working.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS channel varchar(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS redirect_url text;

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'phajay_card';
