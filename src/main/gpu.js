'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * GPU 兼容模式必须早于 app ready 生效，因此这里不依赖 store（safeStorage 需 ready 后才可用），
 * 直接同步读取原始配置文件中的开关位。
 */
function rawConfigFile(app) {
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch (err) {
    return '';
  }
}

function rawEnabled(app) {
  if (process.env.FNOS_GPU_COMPAT === '1') return true;
  if (process.argv.includes('--gpu-compat')) return true;
  const file = rawConfigFile(app);
  if (!file) return false;
  try {
    if (!fs.existsSync(file)) return false;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !!(json && json.settings && json.settings.gpuCompatible);
  } catch (err) {
    return false;
  }
}

function apply(app) {
  if (!rawEnabled(app)) return false;
  try {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-zero-copy');
    app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization=false');
  } catch (err) { /* 开关应用失败时保持默认硬件加速 */ }
  return true;
}

module.exports = { apply, rawEnabled };
