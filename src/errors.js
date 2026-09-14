export class AppError extends Error {
  constructor(status, code, message, data) {
    super(message); Object.assign(this, { status, code, data });
  }
}
export const fail = (status, code, message, data) => { throw new AppError(status, code, message, data); };
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, 'INVALID_ARGUMENT', '参数不正确，请检查字段和格式');
  return result.data;
}
