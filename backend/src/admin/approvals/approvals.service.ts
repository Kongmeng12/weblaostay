import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PARTNER_STATUS } from '../../common/money';

/**
 * A "partner application" is simply a partner row still sitting at
 * status = 'pending'. There is no separate applications table, so approving
 * one is a status transition rather than a copy between tables.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.partners.findMany({
      where: { status: PARTNER_STATUS.PENDING },
      orderBy: { created_at: 'desc' },
      include: {
        properties: {
          select: { id: true, name: true, type: true, province: true, address: true, photos: true },
        },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      ownerName: p.owner_name,
      email: p.email,
      phone: p.phone,
      bankName: p.bank_name,
      appliedAt: p.created_at,
      status: p.status,
      property: p.properties[0]
        ? {
            id: p.properties[0].id,
            name: p.properties[0].name,
            type: p.properties[0].type,
            province: p.properties[0].province,
            address: p.properties[0].address,
          }
        : null,
      propertyCount: p.properties.length,
    }));
  }

  async counts() {
    const [pending, verified, rejected] = await Promise.all([
      this.prisma.partners.count({ where: { status: PARTNER_STATUS.PENDING } }),
      this.prisma.partners.count({ where: { status: PARTNER_STATUS.VERIFIED } }),
      this.prisma.partners.count({ where: { status: PARTNER_STATUS.REJECTED } }),
    ]);
    return { pending, verified, rejected };
  }

  approve(id: bigint) {
    return this.decide(id, PARTNER_STATUS.VERIFIED, {
      title: 'ອະນຸມັດແລ້ວ! 🎉',
      body: 'ໃບສະໝັກທີ່ພັກຂອງທ່ານຜ່ານການອະນຸມັດ — ເລີ່ມຮັບການຈອງໄດ້ເລີຍ',
    });
  }

  reject(id: bigint, reason?: string) {
    return this.decide(id, PARTNER_STATUS.REJECTED, {
      title: 'ໃບສະໝັກບໍ່ຜ່ານ',
      body: reason?.slice(0, 500) ?? 'ໃບສະໝັກຂອງທ່ານຍັງບໍ່ຜ່ານການອະນຸມັດ ກະລຸນາຕິດຕໍ່ຝ່າຍຊ່ວຍເຫຼືອ',
    });
  }

  private async decide(id: bigint, status: string, notice: { title: string; body: string }) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.partners.findUnique({ where: { id } });
      if (!partner) throw new NotFoundException(`ບໍ່ພົບ partner #${id} · Partner not found`);

      // Guard against a double-click racing two decisions onto one application.
      if (partner.status !== PARTNER_STATUS.PENDING) {
        throw new BadRequestException(
          `ໃບສະໝັກນີ້ຕັດສິນໄປແລ້ວ (${partner.status}) · Application already decided`,
        );
      }

      const updated = await tx.partners.update({
        where: { id },
        data: { status },
        select: { id: true, owner_name: true, email: true, status: true },
      });

      await tx.notifications.create({
        data: {
          recipient_type: 'partner',
          recipient_id: id,
          title: notice.title,
          body: notice.body,
          type: 'account',
        },
      });

      return updated;
    });
  }
}
