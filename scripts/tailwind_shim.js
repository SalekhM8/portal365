const fs = require('fs')
const path = require('path')

try {
  const moduleDir = path.join(process.cwd(), 'node_modules', '@tailwindcss', 'postcss')
  const indexFile = path.join(moduleDir, 'index.js')
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true })
  }
  const content = `// Build-time shim: map @tailwindcss/postcss to tailwindcss PostCSS plugin (v3)
module.exports = require('tailwindcss');
`
  fs.writeFileSync(indexFile, content, 'utf8')
  console.log('✅ Tailwind PostCSS shim installed')
} catch (e) {
  console.warn('⚠️ Failed to install Tailwind PostCSS shim:', e?.message || e)
} 