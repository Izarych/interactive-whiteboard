const path = require('node:path');
const sharp = require('sharp');

const publicFile = (name) => path.resolve(__dirname, '../public', name);
const icon = publicFile('favicon.svg');

async function generate() {
  await Promise.all([
    sharp(publicFile('social-card.svg')).png().toFile(publicFile('og-image.png')),
    ...[180, 192, 512].map((size) => sharp(icon).resize(size, size).png().toFile(publicFile(`icon-${size}.png`))),
  ]);
  const mark = await sharp(icon).resize(352, 352).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2563eb' } })
    .composite([{ input: mark, left: 80, top: 80 }]).png().toFile(publicFile('icon-maskable-512.png'));
}

generate().catch((error) => { console.error(error.message); process.exitCode = 1; });
