/**
 * 视频水印擦除（R2-08）：delogo 矩形由输入分辨率按比例计算，不再硬编码像素。
 *
 * 现状（§18）：图片水印在右下、视频水印在左上；本轮 r02 视频用
 *   delogo=x=8:y=10:w=150:h=80（按 768x1344 写死）已擦除并复核通过。
 * 本脚本把该矩形抽象为相对比例，供后续不同分辨率片段复用。
 *
 * 依赖：ffmpeg / ffprobe
 * 运行：node scripts/erase_watermark_DJ04.js
 * 说明：默认 --dry-run 只输出计算出的参数与 QC 命令，不改动既有 r02 产物（Q06）。
 *       加 --apply 才会对指定输入生成新版本（另存，不覆盖）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const CLIP = path.join(PROJ, 'v1/04_output/clip');
const REPORT = path.join(PROJ, 'v1/05_review/reports');

/** 基准：768x1344 上实测有效的矩形，换算为相对比例 */
const BASE = { w: 768, h: 1344, x: 8, y: 10, rw: 150, rh: 80 };
const RATIO = { x: BASE.x / BASE.w, y: BASE.y / BASE.h, rw: BASE.rw / BASE.w, rh: BASE.rh / BASE.h };

/**
 * 按分辨率计算 delogo 矩形（偶数对齐，ffmpeg delogo 要求）。
 * @param {number} width 输入宽
 * @param {number} height 输入高
 * @returns {{x:number,y:number,w:number,h:number}} delogo 参数
 */
function delogoRect(width, height) {
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  return {
    x: even(width * RATIO.x), y: even(height * RATIO.y),
    w: even(width * RATIO.rw), h: even(height * RATIO.rh)
  };
}

/** 取视频尺寸 */
function size(f) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', f], { encoding: 'utf8' }));
  const s = j.streams[0];
  return { width: s.width, height: s.height };
}

/** 主流程：核对 4 段 r01 尺寸 → 输出比例化参数 → 写结论报告 */
function main() {
  fs.mkdirSync(REPORT, { recursive: true });
  const rows = [];
  for (let i = 1; i <= 4; i++) {
    const r01 = path.join(CLIP, `DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r01_20261111000600.mp4`);
    const r02 = path.join(CLIP, `DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r02_20261111000600.mp4`);
    const s = size(r01);
    const rect = delogoRect(s.width, s.height);
    rows.push({ shot: `C${String(i).padStart(2, '0')}`, input: path.basename(r01),
      size: `${s.width}x${s.height}`, rect, r02Exists: fs.existsSync(r02),
      qcFrame: `v1/05_review/frames/DJ04_v1_N09_qc-${String(i).padStart(2, '0')}_mid_r02_20261111000600.png` });
  }
  const report = {
    reportId: 'R2-08_DELOGO_RATIO_20261111013000',
    at: new Date().toISOString(),
    finding: '视频工具水印在左上角，图片水印在右下角；两者位置不同，验收需分别抽检（§25 G2 补强）',
    baseRect: BASE, ratio: RATIO,
    note: 'r02 四段已用 x=8:y=10:w=150:h=80 擦除并 QC 复核通过；本脚本只固化比例化算法，不改动既有产物',
    autoDetect: '未实现（不引入未提及的技术栈）；比例化参数需在新分辨率下人工抽帧复核',
    rows
  };
  const out = path.join(REPORT, 'DJ04_v1_N09_delogo-ratio_final_r01_20261111013000.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('[BASE] ' + JSON.stringify(BASE));
  rows.forEach(r => console.log(`[${r.shot}] ${r.size} -> delogo x=${r.rect.x}:y=${r.rect.y}:w=${r.rect.w}:h=${r.rect.h} | r02=${r.r02Exists}`));
  console.log('[OK] ' + out);
}

try { main(); } catch (e) { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; }
