const path = require('node:path');
const sharp = require('sharp');

sharp(path.resolve(__dirname, '../public/social-card.svg'))
  .png()
  .toFile(path.resolve(__dirname, '../public/og-image.png'))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
