// electron-builder drops node_modules folders from extraResources, but the
// Next.js standalone server needs its own, so copy it after packing.
const { cpSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  cpSync(join(__dirname, '..', '..', 'frontend', '.next', 'standalone', 'node_modules'), join(resources, 'web', 'node_modules'), { recursive: true });
};
