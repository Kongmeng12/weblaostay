import { Injectable, Logger } from '@nestjs/common';
import { agreement_doc_type, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Slug in `app_pages` for each kind of document a user can agree to.
 *
 * These match the enum name for name, which is not a coincidence worth relying
 * on — a slug is a URL and an enum member is not, and they are free to diverge.
 */
const SLUG: Record<agreement_doc_type, string> = {
  terms: 'terms',
  privacy: 'privacy',
  partner_agreement: 'partner_agreement',
};

/** What a customer accepts when they sign up. */
export const SIGNUP_DOCS = [agreement_doc_type.terms, agreement_doc_type.privacy] as const;

/**
 * Who agreed to what, and which wording they saw.
 *
 * A tick box that leaves no trace proves nothing: the point of the record is to
 * be able to say, months later, that this person accepted *this text* on this
 * date from this address. So the version is stored alongside, and it has to
 * change whenever the wording does.
 *
 * `app_pages` has no version column, so the page's `updated_at` date is the
 * version. Editing the terms in the admin CMS moves that date, which means the
 * next person to sign up is recorded against the new wording without anyone
 * having to remember to bump anything.
 */
@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records acceptance of each document.
   *
   * Takes a transaction client because it belongs to the same commit as the
   * account it describes — an account with no agreement row, or an agreement
   * row with no account, would both be worse than failing the sign-up.
   */
  async record(
    tx: Prisma.TransactionClient,
    userId: bigint,
    docs: readonly agreement_doc_type[],
    ip: string | null,
  ): Promise<void> {
    const versions = await this.versions(tx, docs);

    await tx.user_agreements.createMany({
      data: docs.map((document_type) => ({
        user_id: userId,
        document_type,
        version: versions[document_type],
        ip_address: ip?.slice(0, 64) ?? null,
      })),
    });
  }

  /**
   * The current version of each document, as a date.
   *
   * A page that is missing or inactive still gets a version rather than
   * throwing: refusing every sign-up because nobody has written the privacy
   * policy yet would be the wrong trade. It is logged instead, and
   * `unpublished` in the record is an honest description of what the person
   * actually agreed to.
   */
  private async versions(
    tx: Prisma.TransactionClient,
    docs: readonly agreement_doc_type[],
  ): Promise<Record<string, string>> {
    const slugs = docs.map((d) => SLUG[d]);
    const pages = await tx.app_pages.findMany({
      where: { page_slug: { in: slugs }, is_active: true },
      select: { page_slug: true, updated_at: true },
    });

    const bySlug = new Map(pages.map((p) => [p.page_slug, p.updated_at]));
    const out: Record<string, string> = {};

    for (const doc of docs) {
      const updated = bySlug.get(SLUG[doc]);
      if (!updated) {
        this.logger.warn(`No active "${SLUG[doc]}" page — recording agreement as unpublished`);
      }
      out[doc] = updated ? updated.toISOString().slice(0, 10) : 'unpublished';
    }
    return out;
  }
}
