// @ts-check
const { existsSync, symlink } = require('fs');
const { resolve } = require('path');

const destPath = resolve(__dirname, '../packages/server/src/types/interfaces.ts');
const srcPath = resolve(__dirname, '../packages/client/src/package/types/interfaces.ts');

if (existsSync(destPath)) {
  console.warn('Symlink created', destPath);
} else {
  symlink(srcPath, destPath, 'file', (err) => {
    if (err) {
      console.error('Error create symlink', err);
      return;
    }
    console.info('Symlink created', destPath);
  });
}
