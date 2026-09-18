/** รูปแบบ error เดียวกันทั้ง REST และ WebSocket: { error, message, details? } */
export interface ErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toBody(): ErrorBody {
    return this.details
      ? { error: this.code, message: this.message, details: this.details }
      : { error: this.code, message: this.message };
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'ต้องระบุ player token') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'token นี้ไม่ใช่ของผู้เล่นในเกมนี้') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'ไม่พบเกมนี้') => new AppError(404, 'NOT_FOUND', message);
export const versionConflict = (details: Record<string, unknown>) =>
  new AppError(409, 'VERSION_CONFLICT', 'สถานะเกมเปลี่ยนไปแล้ว โหลดสถานะใหม่ก่อนส่งคำสั่งอีกครั้ง', details);
export const rateLimited = (resetSeconds: number) =>
  new AppError(429, 'RATE_LIMITED', 'ส่งคำสั่งถี่เกินไป', { resetSeconds });
export const lockTimeout = () =>
  new AppError(503, 'LOCK_TIMEOUT', 'เกมนี้กำลังประมวลผลคำสั่งอื่น ลองใหม่อีกครั้ง');
