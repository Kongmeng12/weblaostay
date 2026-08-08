import { c, f, radius } from '../theme';
import { Card } from '../components/ui';

/**
 * Discount codes are not built yet.
 *
 * The schema is there — `coupons`, `coupon_usages`, `promotions` and the three
 * join tables that scope a promotion to partners, properties or room types —
 * but nothing in the API reads or writes them, and `discountAmount` on a
 * booking is still hard-coded to zero.
 *
 * The page is kept, and says so plainly, rather than deleted: a missing nav
 * entry reads as "this was never planned", which is the wrong impression. What
 * it must not do is call endpoints that do not exist and show the operator a
 * row of 404s.
 */
export function Promos() {
  return (
    <Card padding={0}>
      <div
        style={{
          padding: '64px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.lg,
            background: c.bg,
            display: 'grid',
            placeItems: 'center',
            fontSize: 28,
            marginBottom: 20,
          }}
        >
          🎟️
        </div>

        <div style={{ font: f(800, 20), color: c.text, marginBottom: 10 }}>
          ໂຄ້ດສ່ວນຫຼຸດຍັງບໍ່ພ້ອມໃຊ້
        </div>

        <div style={{ font: f(400, 13, 22), color: c.muted, maxWidth: 460, marginBottom: 24 }}>
          ຕາຕະລາງໃນຖານຂໍ້ມູນສ້າງໄວ້ແລ້ວ (<Code>coupons</Code>, <Code>coupon_usages</Code>,{' '}
          <Code>promotions</Code>) ແຕ່ຍັງບໍ່ມີ API ອ່ານ ຫຼື ຂຽນ — ແລະ ສ່ວນຫຼຸດໃນການຈອງຍັງເປັນ 0 ຢູ່.
          ຈະເປີດໃຊ້ໃນຮອບຖັດໄປ.
        </div>

        <div
          style={{
            font: f(500, 12, 20),
            color: c.soft,
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: radius.md,
            padding: '12px 16px',
            maxWidth: 460,
          }}
        >
          ຕອນນີ້ຖ້າຢາກໃຫ້ສ່ວນຫຼຸດ ໃຫ້ປັບລາຄາຫ້ອງເປັນຊ່ວງວັນທີ່ຢູ່ໃນ Partner app ແທນ
        </div>
      </div>
    </Card>
  );
}

function Code({ children }: { children: string }) {
  return (
    <span
      style={{
        font: f(600, 12),
        fontFamily: 'ui-monospace, monospace',
        background: c.bg,
        padding: '1px 6px',
        borderRadius: 5,
        color: c.soft,
      }}
    >
      {children}
    </span>
  );
}
