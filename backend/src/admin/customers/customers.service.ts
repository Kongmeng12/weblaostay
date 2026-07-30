import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto, paged } from '../../common/dto/pagination.dto';
import { REVENUE_STATUSES, USER_STATUS } from '../../common/money';
import { bookingCode } from '../dashboard/dashboard.service';

export interface ListCustomersQuery extends PaginationDto {
  status?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListCustomersQuery) {
    const where: Prisma.usersWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.q) {
      const q = dto.q.trim();
      where.OR = [
        { full_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          full_name: true,
          email: true,
          phone: true,
          tier: true,
          points: true,
          status: true,
          is_verified: true,
          created_at: true,
        },
      }),
      this.prisma.users.count({ where }),
    ]);

    // Trips and lifetime spend come from one grouped query over the page's
    // users rather than a per-row query, so the list stays a fixed 2 queries.
    const stats = await this.spendByUser(rows.map((r) => r.id));

    return paged(
      rows.map((u) => ({
        ...u,
        trips: stats.get(u.id.toString())?.trips ?? 0,
        spent: stats.get(u.id.toString())?.spent ?? 0,
      })),
      total,
      dto,
    );
  }

  async findOne(id: bigint) {
    const user = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        full_name: true,
        email: true,
        phone: true,
        tier: true,
        points: true,
        status: true,
        is_verified: true,
        created_at: true,
      },
    });
    if (!user) throw new NotFoundException(`ບໍ່ພົບລູກຄ້າ #${id} · Customer not found`);

    const [bookings, stats] = await Promise.all([
      this.prisma.bookings.findMany({
        where: { user_id: id },
        orderBy: { created_at: 'desc' },
        take: 20,
        include: { properties: { select: { name: true } } },
      }),
      this.spendByUser([id]),
    ]);

    return {
      ...user,
      trips: stats.get(id.toString())?.trips ?? 0,
      spent: stats.get(id.toString())?.spent ?? 0,
      bookings: bookings.map((b) => ({
        id: b.id,
        code: bookingCode(b.id),
        property: b.properties.name,
        checkIn: b.check_in,
        checkOut: b.check_out,
        total: b.total,
        status: b.status,
      })),
    };
  }

  async setStatus(id: bigint, status: string) {
    const exists = await this.prisma.users.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`ບໍ່ພົບລູກຄ້າ #${id} · Customer not found`);

    const user = await this.prisma.users.update({
      where: { id },
      data: { status },
      select: { id: true, full_name: true, status: true },
    });

    await this.prisma.notifications.create({
      data: {
        recipient_type: 'user',
        recipient_id: id,
        title: status === USER_STATUS.SUSPENDED ? 'ບັນຊີຖືກລະງັບ' : 'ບັນຊີກັບມາໃຊ້ງານໄດ້',
        body:
          status === USER_STATUS.SUSPENDED
            ? 'ບັນຊີຂອງທ່ານຖືກລະງັບຊົ່ວຄາວ ກະລຸນາຕິດຕໍ່ຝ່າຍຊ່ວຍເຫຼືອ'
            : 'ບັນຊີຂອງທ່ານກັບມາໃຊ້ງານໄດ້ຕາມປົກກະຕິແລ້ວ',
        type: 'account',
      },
    });

    return user;
  }

  /** Header counts above the customer table. */
  async summary() {
    const [total, active, suspended] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.users.count({ where: { status: USER_STATUS.ACTIVE } }),
      this.prisma.users.count({ where: { status: USER_STATUS.SUSPENDED } }),
    ]);
    return { total, active, suspended };
  }

  private async spendByUser(ids: bigint[]) {
    if (!ids.length) return new Map<string, { trips: number; spent: number }>();

    const rows = await this.prisma.bookings.groupBy({
      by: ['user_id'],
      where: { user_id: { in: ids }, status: { in: [...REVENUE_STATUSES] } },
      _count: true,
      _sum: { total: true },
    });

    return new Map(
      rows.map((r) => [r.user_id.toString(), { trips: r._count, spent: r._sum.total ?? 0 }]),
    );
  }
}
