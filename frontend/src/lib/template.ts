export const HTML_LIMIT = 256 * 1024;
export const TEXT_LIMIT = 16 * 1024;
export const SAMPLE_CODE = '083721';
export const SAMPLE_MINUTES = '5';

export const TEMPLATE_VARIABLES = [
  { token: '{{code}}', label: '验证码' },
  { token: '{{expires_minutes}}', label: '有效分钟数' },
] as const;

export const defaultText = '您的验证码为 {{code}}，{{expires_minutes}} 分钟内有效。如非本人操作，请忽略此邮件。';
export const defaultTemplate = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:40px 16px;background:#f3f3ef;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#16201a">
  <table role="presentation" style="width:100%;max-width:520px;margin:auto;border-collapse:collapse;background:#ffffff">
    <tr><td style="padding:40px 36px">
      <p style="margin:0 0 24px;font-size:22px;font-weight:700">验证您的邮箱</p>
      <p style="margin:0;font-size:14px;line-height:1.8;color:#5c6860">请使用以下验证码完成邮箱验证。</p>
      <p style="margin:28px 0;padding:20px;background:#f3f3ef;text-align:center;color:#16201a;font-size:32px;font-weight:700;letter-spacing:8px">{{code}}</p>
      <p style="margin:0;font-size:14px;line-height:1.8;color:#5c6860">验证码在 {{expires_minutes}} 分钟内有效，请勿向他人透露。</p>
      <p style="margin:32px 0 0;border-top:1px solid #e6e6e0;padding-top:20px;font-size:12px;line-height:1.8;color:#8a938d">如非本人操作，请忽略此邮件。此邮件由系统自动发送。</p>
    </td></tr>
  </table>
</body>
</html>`;

export const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** 与后端同一套约束：必须有 {{code}}，只认两个变量，且不超过字节上限。 */
export function validateTemplate(value: string, maxBytes = HTML_LIMIT) {
  if (!value.includes('{{code}}')) throw new Error('内容必须包含 {{code}}，用于显示验证码。');
  if (/{{|}}/.test(value.replace(/{{(code|expires_minutes)}}/g, ''))) throw new Error('只支持 {{code}} 和 {{expires_minutes}} 两个变量，请检查拼写。');
  if (byteLength(value) > maxBytes) throw new Error(`内容过大，请控制在 ${maxBytes / 1024} KiB 以内。`);
  return value;
}

export const renderTemplate = (value: string) => value.replace(/{{code}}/g, SAMPLE_CODE).replace(/{{expires_minutes}}/g, SAMPLE_MINUTES);

export const PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'";

/**
 * 预览文档只能放进 sandbox="" 的 iframe。限制策略写在模板内容之前，
 * 模板里的任何标签都来不及在它生效前执行或加载资源。
 */
export const previewDocument = (html: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer">${renderTemplate(html)}`;
