import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PROMO_TYPE, type PromoType } from '../../common/money';

// Re-exported for the controller and the existing admin DTOs, which import the
// promo vocabulary from here. The definition itself lives in common/money.ts
// now that the customer booking flow needs it too.
export { PROMO_TYPE, type PromoType };

export interface PromoInput {
  code: string;
  type: PromoType;
  value: number;
  expiresAt: string;
  isActive?: boolean;
}

@Injectable()
export class PromosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeExpired = true) {
    const rows = await this.prisma.promos.findMany({
      orderBy: [{ is_active: 'desc' }, { expires_at: 'desc' }],
      include: { _count: { select: { bookings: true } } },
    });

    const now = startOfToday();
    const items = rows
      .map((p) => ({
        id: p.id,
        code: p.code,
        type: p.type,
        value: p.value,
        usedCount: p.used_count ?? 0,
        bookingCount: p._count.bookings,
        expiresAt: p.expires_at,
        isActive: p.is_active,
        // A promo is spent if it is switched off *or* the date has passed.
        isExpired: p.expires_at < now,
      }))
      .filter((p) => includeExpired || (!p.isExpired && p.isActive));

    return { items, total: items.length };
  }

  async create(dto: PromoInput) {
    this.assertValue(dto);
    return this.prisma.promos.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        type: dto.type,
        value: dto.value,
        expires_at: new Date(dto.expiresAt),
        is_active: dto.isActive ?? true,
      },
    });
  }

  async update(id: bigint, dto: Partial<PromoInput>) {
    const existing = await this.prisma.promos.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`ບໍ່ພົບໂຄ້ດ #${id} · Promo not found`);

    if (dto.value !== undefined) {
      this.assertValue({ type: dto.type ?? (existing.type as PromoType), value: dto.value });
    }

    const data: Prisma.promosUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.expiresAt !== undefined) data.expires_at = new Date(dto.expiresAt);
    if (dto.isActive !== undefined) data.is_active = dto.isActive;

    return this.prisma.promos.update({ where: { id }, data });
  }

  /**
   * Promo codes are referenced by bookings, so deleting one would orphan
   * history. A code that has ever been used is deactivated instead; only a
   * never-used code is really removed.
   */
  async remove(id: bigint) {
    const promo = await this.prisma.promos.findUnique({
      where: { id },
      include: { _count: { select: { bookings: true } } },
    });
    if (!promo) throw new NotFoundException(`ບໍ່ພົບໂຄ້ດ #${id} · Promo not found`);

    if (promo._count.bookings > 0) {
      const updated = await this.prisma.promos.update({
        where: { id },
        data: { is_active: false },
      });
      return {
        deleted: false,
        deactivated: true,
        reason: `ໂຄ້ດນີ້ຖືກໃຊ້ໃນ ${promo._count.bookings} ການຈອງ — ປິດການໃຊ້ງານແທນການລຶບ`,
        promo: updated,
      };
    }

    await this.prisma.promos.delete({ where: { id } });
    return { deleted: true, deactivated: false, promo };
  }

  private assertValue(dto: { type: PromoType; value: number }) {
    if (dto.value <= 0) {
      throw new BadRequestException('ມູນຄ່າຕ້ອງຫຼາຍກວ່າ 0 · Value must be greater than 0');
    }
    if (dto.type === PROMO_TYPE.PERCENT && dto.value > 100) {
      throw new BadRequestException('ສ່ວນຫຼຸດເປັນ % ຕ້ອງບໍ່ເກີນ 100 · Percent cannot exceed 100');
    }
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
