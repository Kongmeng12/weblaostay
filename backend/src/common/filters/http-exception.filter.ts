import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * One response shape for every failure so the frontend never has to guess:
 *   { statusCode, message, error, path, timestamp }
 *
 * Prisma errors are translated rather than leaked — a unique-constraint
 * violation should read as 409 "already exists", not a 500 with internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'ເກີດຂໍ້ຜິດພາດ · Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      error = exception.name;
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message, error } = translatePrisma(exception));
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      ({ status, message, error } = translateRaw(exception.message));
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      error = 'ValidationError';
      message = 'ຂໍ້ມູນທີ່ສົ່ງມາບໍ່ຖືກຕ້ອງ · Invalid query arguments';
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}

function translatePrisma(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
  error: string;
} {
  const target = (e.meta?.target as string[] | string | undefined) ?? '';
  const field = Array.isArray(target) ? target.join(', ') : target;

  switch (e.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: `ມີຢູ່ແລ້ວ · Already exists${field ? ` (${field})` : ''}`,
      };
    // Two transactions wanted the same rows. Nobody did anything wrong, so this
    // is not a 500: the caller should simply try again.
    case 'P2034':
      return {
        status: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'ມີຄົນກຳລັງແກ້ຂໍ້ມູນດຽວກັນ ກະລຸນາລອງໃໝ່ · Busy — please try again',
      };
    // The transaction ran out of time, which under load means it spent that
    // time queued behind someone else's lock.
    case 'P2028':
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Busy',
        message: 'ລະບົບກຳລັງຫຍຸ້ງ ກະລຸນາລອງໃໝ່ · The system is busy — please try again',
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'BadRequest',
        message: 'ອ້າງອິງຂໍ້ມູນທີ່ບໍ່ມີຢູ່ · Referenced record does not exist',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        error: 'NotFound',
        message: 'ບໍ່ພົບຂໍ້ມູນ · Record not found',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'DatabaseError',
        message: `ຖານຂໍ້ມູນຜິດພາດ · Database error (${e.code})`,
      };
  }
}

/**
 * Raw queries come back as `PrismaClientUnknownRequestError` with the Postgres
 * SQLSTATE buried in the message rather than in a field, so it has to be read
 * out of the text.
 *
 * Only contention is translated. Everything else really is a server fault and
 * should stay a 500 — a CHECK constraint firing means this code tried to write
 * something the schema forbids, and hiding that behind a 400 would blame the
 * caller for our bug.
 */
function translateRaw(raw: string): { status: number; message: string; error: string } {
  const sqlState = /code: "([0-9A-Z]{5})"/.exec(raw)?.[1];

  // 40001 serialization_failure · 40P01 deadlock_detected · 55P03 lock_not_available
  if (sqlState === '40001' || sqlState === '40P01' || sqlState === '55P03') {
    return {
      status: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'ມີຄົນກຳລັງຈອງພ້ອມກັນ ກະລຸນາລອງໃໝ່ · Someone booked at the same moment — try again',
    };
  }

  // The last line of defence against overselling. If it fires, a race got past
  // the application's own check and the right answer is still "room's gone".
  if (raw.includes('room_inventory_no_overbook')) {
    return {
      status: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'ຫ້ອງເຕັມແລ້ວ · That room is fully booked',
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'InternalServerError',
    message: 'ເກີດຂໍ້ຜິດພາດ · Internal server error',
  };
}
