import { Link } from 'react-router-dom';
import { c, f, type as t } from '../theme';
import { Button, Card, Page } from '../components/ui';

/**
 * Where a guest's check-in QR lands when someone scans it with an ordinary
 * phone camera instead of the partner app (`/c/<signed token>`).
 *
 * Deliberately says nothing about the booking: the token in the URL is never
 * read or sent anywhere from here, so a QR photographed off a guest's screen
 * reveals no name, dates or property. Only the partner app, signed in as the
 * owning property, turns the token into a booking.
 */
export function CheckInQrPage() {
  return (
    <Page>
      <Card padding={32} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>🏨</div>
        <h1 style={{ font: t.h2, color: c.text, margin: '14px 0 6px' }}>QR ເຊັກອິນ PhaPhak</h1>
        <p style={{ font: f(400, 14, 22), color: c.muted, margin: 0 }}>
          ສະແດງ QR ນີ້ໃຫ້ພະນັກງານທີ່ພັກຕອນມາຮອດ — ພະນັກງານຈະສະແກນດ້ວຍແອັບ PhaPhak Partner.
        </p>
        <p style={{ font: f(400, 13, 20), color: c.muted, margin: '6px 0 0' }}>
          Show this QR to the front desk when you arrive. Staff scan it with the PhaPhak Partner app.
        </p>
        <div style={{ marginTop: 22 }}>
          <Link to="/trips">
            <Button variant="outline">ການເດີນທາງຂອງຂ້ອຍ · My trips</Button>
          </Link>
        </div>
      </Card>
    </Page>
  );
}
