export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function positiveInt(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
}
