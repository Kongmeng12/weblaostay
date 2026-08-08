import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { banner_target_type, target_user_type } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { todayUtc } from '../common/dates';

/**
 * Editorial content: home banners, announcements, FAQs, and the static pages.
 *
 * Two audiences with different rules. The public read returns only what is
 * live *right now* — active, and inside its date window. The admin read returns
 * everything, because scheduling next month's banner means seeing it before it
 * runs.
 */
@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── public ────────────────────────────────────────────────────────────────

  /**
   * Everything a client needs to paint its home screen, in one call.
   *
   * One round trip rather than four: a cold app start on a Lao mobile network
   * pays for each request separately, and none of these is worth its own.
   */
  async home(audience: target_user_type = target_user_type.CUSTOMER) {
    const today = todayUtc();
    const live = {
      is_active: true,
      AND: [
        { OR: [{ start_date: null }, { start_date: { lte: today } }] },
        { OR: [{ end_date: null }, { end_date: { gte: today } }] },
      ],
    };

    const [banners, announcements] = await Promise.all([
      this.prisma.banners.findMany({ where: live, orderBy: { display_order: 'asc' }, take: 10 }),
      this.prisma.announcements.findMany({
        where: {
          ...live,
          target_user_type: { in: [target_user_type.ALL, audience] },
        },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
    ]);

    return {
      banners: banners.map(toBannerView),
      announcements: announcements.map((a) => ({
        id: a.announcement_id.toString(),
        title: a.title,
        content: a.content,
        startDate: a.start_date,
        endDate: a.end_date,
      })),
    };
  }

  async faqs() {
    const rows = await this.prisma.faqs.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: 'asc' }, { faq_id: 'asc' }],
    });

    // Grouped, because a flat list of twenty questions is not something anyone
    // reads. `category` is free text, so the order comes from `display_order`
    // rather than an alphabet nobody chose.
    const groups: { category: string; items: { id: string; question: string; answer: string }[] }[] =
      [];
    for (const row of rows) {
      const name = row.category ?? 'ອື່ນໆ';
      let group = groups.find((g) => g.category === name);
      if (!group) {
        group = { category: name, items: [] };
        groups.push(group);
      }
      group.items.push({
        id: row.faq_id.toString(),
        question: row.question,
        answer: row.answer,
      });
    }
    return groups;
  }

  /**
   * A static page by slug.
   *
   * An inactive page 404s rather than returning empty content. The legal pages
   * ship inactive with placeholder bodies on purpose — showing a guest an empty
   * "Terms of Service" is worse than admitting there is not one yet.
   */
  async page(slug: string) {
    const page = await this.prisma.app_pages.findFirst({
      where: { page_slug: slug, is_active: true },
    });
    if (!page) throw new NotFoundException(`ບໍ່ພົບໜ້າ "${slug}" · Page not found`);

    return {
      slug: page.page_slug,
      title: page.title,
      content: page.content,
      updatedAt: page.updated_at,
    };
  }

  /** The slugs that are live, so a client can hide links to pages that are not. */
  async pageIndex() {
    const rows = await this.prisma.app_pages.findMany({
      where: { is_active: true },
      select: { page_slug: true, title: true, updated_at: true },
      orderBy: { page_slug: 'asc' },
    });
    return rows.map((p) => ({ slug: p.page_slug, title: p.title, updatedAt: p.updated_at }));
  }

  // ── admin ─────────────────────────────────────────────────────────────────

  async allBanners() {
    const rows = await this.prisma.banners.findMany({
      orderBy: [{ display_order: 'asc' }, { banner_id: 'desc' }],
    });
    return rows.map(toBannerView);
  }

  async saveBanner(
    adminUserId: bigint,
    input: {
      id?: bigint;
      title: string;
      description?: string;
      imageUrl?: string;
      targetType?: banner_target_type;
      targetId?: string;
      displayOrder?: number;
      startDate?: string;
      endDate?: string;
      isActive?: boolean;
    },
  ) {
    // `(target_type, target_id)` is a polymorphic pointer with no foreign key —
    // nothing in the database stops it naming a property that does not exist,
    // so it is checked here or not at all.
    await this.assertTargetResolves(input.targetType, input.targetId);

    const data = {
      title: input.title,
      description: input.description ?? null,
      image_url: input.imageUrl ?? null,
      target_type: input.targetType ?? null,
      target_id: input.targetId ? BigInt(input.targetId) : null,
      display_order: input.displayOrder ?? 0,
      start_date: input.startDate ? new Date(input.startDate) : null,
      end_date: input.endDate ? new Date(input.endDate) : null,
      is_active: input.isActive ?? true,
    };

    const saved = input.id
      ? await this.prisma.banners.update({ where: { banner_id: input.id }, data })
      : await this.prisma.banners.create({ data: { ...data, created_by: adminUserId } });

    return toBannerView(saved);
  }

  private async assertTargetResolves(type?: banner_target_type, id?: string) {
    if (!type || type === banner_target_type.url) return;
    if (!id) {
      throw new BadRequestException('ຕ້ອງລະບຸເປົ້າໝາຍ · A target id is required for that type');
    }

    const targetId = BigInt(id);
    const exists =
      type === banner_target_type.property
        ? await this.prisma.properties.count({
            where: { property_id: targetId, deleted_at: null },
          })
        : await this.prisma.promotions.count({ where: { promotion_id: targetId } });

    if (!exists) {
      throw new BadRequestException(`ບໍ່ພົບເປົ້າໝາຍ ${type} #${id} · Banner target does not exist`);
    }
  }

  async removeBanner(id: bigint) {
    await this.prisma.banners.delete({ where: { banner_id: id } });
    return { id: id.toString(), deleted: true };
  }

  async allAnnouncements() {
    const rows = await this.prisma.announcements.findMany({ orderBy: { created_at: 'desc' } });
    return rows.map((a) => ({
      id: a.announcement_id.toString(),
      title: a.title,
      content: a.content,
      audience: a.target_user_type,
      startDate: a.start_date,
      endDate: a.end_date,
      isActive: a.is_active,
      createdAt: a.created_at,
    }));
  }

  async saveAnnouncement(
    adminUserId: bigint,
    input: {
      id?: bigint;
      title: string;
      content?: string;
      audience?: target_user_type;
      startDate?: string;
      endDate?: string;
      isActive?: boolean;
    },
  ) {
    const data = {
      title: input.title,
      content: input.content ?? null,
      target_user_type: input.audience ?? target_user_type.ALL,
      start_date: input.startDate ? new Date(input.startDate) : null,
      end_date: input.endDate ? new Date(input.endDate) : null,
      is_active: input.isActive ?? true,
    };

    const saved = input.id
      ? await this.prisma.announcements.update({ where: { announcement_id: input.id }, data })
      : await this.prisma.announcements.create({ data: { ...data, created_by: adminUserId } });

    return { id: saved.announcement_id.toString(), title: saved.title, isActive: saved.is_active };
  }

  async removeAnnouncement(id: bigint) {
    await this.prisma.announcements.delete({ where: { announcement_id: id } });
    return { id: id.toString(), deleted: true };
  }

  async allFaqs() {
    const rows = await this.prisma.faqs.findMany({
      orderBy: [{ display_order: 'asc' }, { faq_id: 'asc' }],
    });
    return rows.map((f) => ({
      id: f.faq_id.toString(),
      category: f.category,
      question: f.question,
      answer: f.answer,
      order: f.display_order,
      isActive: f.is_active,
    }));
  }

  async saveFaq(
    adminUserId: bigint,
    input: {
      id?: bigint;
      category?: string;
      question: string;
      answer: string;
      displayOrder?: number;
      isActive?: boolean;
    },
  ) {
    const data = {
      category: input.category ?? null,
      question: input.question,
      answer: input.answer,
      display_order: input.displayOrder ?? 0,
      is_active: input.isActive ?? true,
    };

    const saved = input.id
      ? await this.prisma.faqs.update({ where: { faq_id: input.id }, data })
      : await this.prisma.faqs.create({ data: { ...data, created_by: adminUserId } });

    return { id: saved.faq_id.toString(), question: saved.question, isActive: saved.is_active };
  }

  async removeFaq(id: bigint) {
    await this.prisma.faqs.delete({ where: { faq_id: id } });
    return { id: id.toString(), deleted: true };
  }

  async allPages() {
    const rows = await this.prisma.app_pages.findMany({ orderBy: { page_slug: 'asc' } });
    return rows.map((p) => ({
      slug: p.page_slug,
      title: p.title,
      content: p.content,
      isActive: p.is_active,
      updatedAt: p.updated_at,
    }));
  }

  /**
   * Upsert by slug.
   *
   * Slugs are referenced by name from the apps (`terms`, `privacy`) and from
   * `user_agreements.document_type`, so they are the key rather than an id, and
   * editing one never changes what a link points at.
   */
  async savePage(
    adminUserId: bigint,
    input: { slug: string; title: string; content?: string; isActive?: boolean },
  ) {
    const saved = await this.prisma.app_pages.upsert({
      where: { page_slug: input.slug },
      create: {
        page_slug: input.slug,
        title: input.title,
        content: input.content ?? null,
        is_active: input.isActive ?? false,
        updated_by: adminUserId,
      },
      update: {
        title: input.title,
        ...(input.content !== undefined && { content: input.content }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        updated_by: adminUserId,
        updated_at: new Date(),
      },
    });

    return {
      slug: saved.page_slug,
      title: saved.title,
      isActive: saved.is_active,
      updatedAt: saved.updated_at,
    };
  }
}

function toBannerView(b: {
  banner_id: bigint;
  title: string;
  description: string | null;
  image_url: string | null;
  target_type: banner_target_type | null;
  target_id: bigint | null;
  display_order: number;
  start_date: Date | null;
  end_date: Date | null;
  is_active: boolean;
}) {
  return {
    id: b.banner_id.toString(),
    title: b.title,
    description: b.description,
    imageUrl: b.image_url,
    targetType: b.target_type,
    targetId: b.target_id?.toString() ?? null,
    order: b.display_order,
    startDate: b.start_date,
    endDate: b.end_date,
    isActive: b.is_active,
  };
}
