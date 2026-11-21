'use strict';

/**
 * macOS 上没有代码签名（含 ad-hoc）的 app 不会出现在「系统设置 › 隐私与安全性 › 本地网络」
 * 的授权列表里，内网 IP 访问会被系统静默拦截（表现为连接超时）。
 * 无证书构建时统一补 ad-hoc 签名，保证首次访问局域网能弹出并记录授权。
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    console.log(`[after-pack] ad-hoc 签名完成: ${appPath}`);
  } catch (err) {
    console.error('[after-pack] ad-hoc 签名失败（继续打包）:', (err && err.message) || err);
  }
};
