const mailhog = process.env.MAILHOG_URL ?? 'http://localhost:8025';

function bodyText(message) {
  const plain = message.MIME?.Parts?.find((part) => part.Headers['Content-Type']?.[0]?.startsWith('text/plain'));
  if (plain) return bodyText({ Content: { Body: plain.Body, Headers: plain.Headers } });
  const body = message.Content.Body;
  const encoding = message.Content.Headers['Content-Transfer-Encoding']?.[0]?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (encoding === 'quoted-printable') {
    const bytes = body.replace(/=\r?\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'latin1').toString('utf8');
  }
  return body;
}

async function emailCode(email, seen = new Set()) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(`${mailhog}/api/v2/search?kind=to&query=${encodeURIComponent(email)}&limit=100`);
    if (!response.ok) throw new Error('MailHog is unavailable');
    const { items } = await response.json();
    const message = items.find((item) => !seen.has(item.ID) && item.To.some((to) => `${to.Mailbox}@${to.Domain}`.toLowerCase() === email.toLowerCase()));
    if (message) {
      seen.add(message.ID);
      const code = bodyText(message).match(/Код:\s*(\d{6})/)?.[1];
      if (!code) throw new Error('Email contains no confirmation code');
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No new MailHog message for ${email}`);
}

async function cleanupMail(email) {
  const response = await fetch(`${mailhog}/api/v2/search?kind=to&query=${encodeURIComponent(email)}&limit=100`);
  if (!response.ok) return;
  const { items } = await response.json();
  for (const message of items) {
    if (message.To.some((to) => `${to.Mailbox}@${to.Domain}`.toLowerCase() === email.toLowerCase())) {
      await fetch(`${mailhog}/api/v1/messages/${encodeURIComponent(message.ID)}`, { method: 'DELETE' });
    }
  }
}

module.exports = { emailCode, cleanupMail };
