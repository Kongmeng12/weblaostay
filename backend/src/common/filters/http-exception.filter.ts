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
