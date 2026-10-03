export const number = (value: number | null | undefined) => new Intl.NumberFormat('zh-CN').format(value ?? 0);
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char as '&' | '<' | '>' | '"' | "'"]);

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const dateTime = (value: number | null | undefined) => value == null ? '—' : dateFormatter.format(new Date(value));
export const customerLink = (id: string) => `/customers/${encodeURIComponent(id)}`;
export const templateLink = (id: string) => `/customers/${encodeURIComponent(id)}/template`;
export const customerRecordsLink = (id: string) => `/customers/${encodeURIComponent(id)}/records`;
export const recordsLink = (status = '') => `/records${status ? `?status=${encodeURIComponent(status)}` : ''}`;
export const statusLabels: Record<string, string> = { accepted: '已受理', pending: '处理中', unknown: '待确认', failed: '未计费' };

export function quotaTarget(current: number, increase: string | number) {
  if (!/^\d+$/.test(String(increase))) throw new Error('请输入大于 0 的整数增加量。');
  const amount = Number(increase);
  const target = current + amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(target)) throw new Error('增加量必须大于 0，且总额度不能超过安全整数范围。');
  return target;
}

export function validateTemplate(value: string, maxBytes = 256 * 1024) {
  if (!value.includes('{{code}}')) throw new Error('内容必须包含 {{code}}，用于显示验证码。');
  if (/{{|}}/.test(value.replace(/{{(code|expires_minutes)}}/g, ''))) throw new Error('只支持 {{code}} 和 {{expires_minutes}} 两个变量，请检查拼写。');
  if (new TextEncoder().encode(value).length > maxBytes) throw new Error(`内容过大，请控制在 ${maxBytes / 1024} KiB 以内。`);
  return value;
}

export function dateBoundary(value: string | undefined, end = false) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期。');
  const result = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`);
  if (!Number.isFinite(result) || result < 0) throw new Error('日期格式不正确。');
  return result;
}

export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'";
export const previewDocument = (rendered: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer">${rendered}`;
