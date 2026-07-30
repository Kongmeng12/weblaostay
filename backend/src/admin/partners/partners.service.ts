import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { REVENUE_STATUSES } from '../../common/money';

export interface ListPartnersQuery extends PaginationDto {
  status?: string;
  province?: string;
}

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListPartnersQuery) {
    const where: Prisma.partnersWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.province) where.properties = { some: { province: dto.province } };
    if (dto.q) {
      const q = dto.q.trim();
      where.OR = [
        { owner_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { properties: { some: { name: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.partners.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        include: {
          properties: {
            select: {
              id: true,
              name: true,
              province: true,
              rating: true,
              review_count: true,
              _count: { select: { rooms: true } },
            },
          },
        },
      }),
      this.prisma.partners.count({ where }),
    ]);

    const revenue = await this.revenueByPartner(rows.map((r) => r.id));

    return paged(
      rows.map((p) => {
        const main = p.properties[0];
        return {
          id: p.id,
          ownerName: p.owner_name,
          email: p.email,
          phone: p.phone,
          status: p.status,
          commissionRate: p.commission_rate,
          bankName: p.bank_name,
          createdAt: p.created_at,
          propertyName: main?.name ?? p.owner_name,
          province: main?.province ?? null,
          rating: main?.rating ?? null,
          reviewCount: main?.review_count ?? 0,
          propertyCount: p.properties.length,
          roomCount: p.properties.reduce((s, pr) => s + pr._count.rooms, 0),
          revenue: revenue.get(p.id.toString()) ?? 0,
        };
      }),
      total,
      dto,
    );
  }

  async findOne(id: bigint) {
    const partner = await this.prisma.partners.findUnique({
      where: { id },
      include: {
        properties: {
          include: {
            rooms: {
              select: {
                id: true,
                name: true,
                room_no: true,
                has_ac: true,
                bed_type: true,
                base_price: true,
                capacity: true,
                qty: true,
                is_active: true,
              },
            },
            _count: { select: { bookings: true, reviews: true } },
          },
        },
        payouts: { orderBy: { period_start: 'desc' }, take: 10 },
      },
    });

    if (!partner) throw new NotFoundException(`ບໍ່ພົບ partner #${id} · Partner not found`);

    const revenue = await this.revenueByPartner([id]);

    return {
      ...partner,
      // Only the last 4 digits ever leave the server.
      bank_account: partner.bank_account ? `***${partner.bank_account.slice(-4)}` : null,
      revenue: revenue.get(id.toString()) ?? 0,
    };
  }

  async update(
    id: bigint,
    patch: { status?: string; commissionRate?: number; bankName?: string; bankAccount?: string },
  ) {
    const exists = await this.prisma.partners.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`ບໍ່ພົບ partner #${id} · Partner not found`);

    return this.prisma.partners.update({
      where: { id },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.commissionRate !== undefined && {
          commission_rate: new Prisma.Decimal(patch.commissionRate),
        }),
        ...(patch.bankName !== undefined && { bank_name: patch.bankName }),
        ...(patch.bankAccount !== undefined && { bank_account: patch.bankAccount }),
      },
      select: { id: true, owner_name: true, status: true, commission_rate: true, bank_name: true },
    });
  }

  /** Province filter options for the toolbar, taken from live data. */
  async provinces() {
    const rows = await this.prisma.properties.groupBy({
      by: ['province'],
      _count: true,
      orderBy: { province: 'asc' },
    });
    return rows.map((r) => ({ province: r.province, count: r._count }));
  }

  private async revenueByPartner(ids: bigint[]) {
    if (!ids.length) return new Map<string, number>();

    const rows = await this.prisma.$queryRaw<{ partner_id: bigint; total: bigint }[]>`
      SELECT p.partner_id, COALESCE(SUM(b.total), 0)::bigint AS total
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      WHERE p.partner_id = ANY(${ids}::bigint[])
        AND b.status = ANY(${REVENUE_STATUSES}::varchar[])
      GROUP BY 1
    `;
    return new Map(rows.map((r) => [r.partner_id.toString(), Number(r.total)]));
  }
}
