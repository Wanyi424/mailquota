export const defaultText = '您的验证码为 {{code}}，{{expires_minutes}} 分钟内有效。如非本人操作，请忽略此邮件。';
export const defaultTemplate = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:40px 16px;background:#f5f6fa;font-family:Arial,'Microsoft YaHei',sans-serif;color:#202536">
  <table role="presentation" style="width:100%;max-width:520px;margin:auto;border-collapse:collapse;background:#ffffff">
    <tr><td style="padding:40px 36px">
      <p style="margin:0 0 24px;font-size:22px;font-weight:700">验证您的邮箱</p>
      <p style="font-size:14px;line-height:1.8;color:#646b7d">请使用以下验证码完成邮箱验证。</p>
      <p style="margin:28px 0;padding:20px;background:#f2f0fc;text-align:center;color:#6654b8;font-size:32px;font-weight:700;letter-spacing:8px">{{code}}</p>
      <p style="font-size:14px;line-height:1.8;color:#646b7d">验证码在 {{expires_minutes}} 分钟内有效，请勿向他人透露。</p>
      <p style="margin:32px 0 0;border-top:1px solid #eceef3;padding-top:20px;font-size:12px;line-height:1.8;color:#858b98">如非本人操作，请忽略此邮件。此邮件由系统自动发送。</p>
    </td></tr>
  </table>
</body>
</html>`;
