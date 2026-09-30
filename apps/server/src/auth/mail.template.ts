export function renderCodeEmail(code: string, purpose: 'register' | 'reset', webOrigin: string, preview = false) {
  const registration = purpose === 'register';
  const title = registration ? 'Ваши идеи начинаются здесь' : 'Вернём доступ к вашим идеям';
  const description = registration
    ? 'Остался один шаг: подтвердите почту, чтобы сохранить свои доски в аккаунте BluviBoard.'
    : 'Мы получили запрос на восстановление пароля. Введите этот код в BluviBoard и придумайте новый пароль.';
  const safeUrl = webOrigin.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return {
    subject: preview ? 'BluviBoard — тестовое письмо' : registration ? 'Подтверждение почты — BluviBoard' : 'Восстановление пароля — BluviBoard',
    text: `Код: ${code}\n\n${description}\n\nКод действует 15 минут. ${preview ? 'Это пример оформления письма; код не связан с регистрацией.' : 'Если вы не запрашивали письмо, просто проигнорируйте его.'}`,
    html: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f6fc;font-family:Arial,Helvetica,sans-serif;color:#202938">
<div style="display:none;max-height:0;overflow:hidden">${registration ? 'Подтвердите почту' : 'Восстановите доступ'} — ваш код BluviBoard действует 15 минут.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fc"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border:1px solid #e4eaf5;border-radius:24px;overflow:hidden;background:#ffffff">
<tr><td style="padding:30px 36px;background:#2563eb;background:linear-gradient(120deg,#2586ff,#4f46d9)">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:40px;height:40px;text-align:center;border-radius:12px;background:#ffffff;color:#2563eb;font-size:28px;font-weight:700">B</td>
<td style="padding-left:12px;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-.7px">BluviBoard</td></tr></table>
<p style="margin:18px 0 0;color:#dbeafe;font-size:13px">Пространство, где идеи обретают форму</p></td></tr>
<tr><td style="padding:36px"><p style="margin:0 0 12px;color:#6366f1;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${registration ? 'Добро пожаловать' : 'Восстановление доступа'}</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;letter-spacing:-.8px">${title}</h1>
<p style="margin:0 0 26px;color:#7a8497;font-size:14px;line-height:1.8">${description}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f5ff;border:1px solid #dce7ff;border-radius:16px"><tr><td align="center" style="padding:24px 12px">
<p style="margin:0 0 12px;color:#7b8bad;font-size:12px">Ваш код ${registration ? 'подтверждения' : 'восстановления'}</p>
<p style="margin:0;color:#2563eb;font-family:Consolas,Monaco,monospace;font-size:36px;font-weight:700;letter-spacing:8px;padding-left:8px">${code}</p>
<p style="margin:12px 0 0;color:#94a3b8;font-size:11px">Действует 15 минут</p></td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto"><tr><td align="center" style="border-radius:10px;background:#6366f1"><a href="${safeUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700">Открыть BluviBoard →</a></td></tr></table>
<p style="margin:0;color:#a0a8b8;font-size:12px;line-height:1.8">${preview ? 'Это тест оформления письма. Данный код не создаёт аккаунт и не меняет пароль.' : 'Не запрашивали письмо? Просто проигнорируйте его — никаких действий не требуется.'}</p></td></tr>
<tr><td style="padding:22px 36px;background:#fafbfe;border-top:1px solid #edf0f7"><p style="margin:0;color:#929cb0;font-size:11px;line-height:1.8">Рисуйте. Собирайте вдохновение. Сохраняйте важное.<br><strong style="color:#6e7b94;font-weight:600">Ваша команда BluviBoard</strong></p></td></tr>
</table><p style="margin:22px 0 0;color:#a1a9b8;font-size:10px">BluviBoard · Ваши идеи остаются с вами</p></td></tr></table></body></html>`,
  };
}
