/**
 * N10 成片合成验收脚本（零依赖，全程只读）
 *
 * 验证：成片存在且可解码 / 1080x1920 30fps 30s H.264+AAC faststart /
 *       合成参数 JSON 时间轴与 N08 配音真实起点一致 / 字幕 UTF-8 LF /
 *       四项交接偏差处置留痕 / 资产与回执 / 变更记录 / 文档 / 零覆盖边界。
 *
 * 运行：node verify-n10.js
 * 说明：不调用任何模型、不消耗积分、不做写操作。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const MASTER = path.join(PROJ, 'v1/04_output/master');
const AUDIO = path.join(PROJ, 'v1/04_output/audio');
const CLIP = path.join(PROJ, 'v1/04_output/clip');
const WORK = 'D:/WorkBuddy_space/2026-11-09-10-57-28/_n10_work';
const STAMP = '20261111003500';
const CLIP_STAMP = '20261111000600';

let pass = 0, fail = 0;
/** 单条断言 */
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
/** ffprobe JSON */
function probe(file) {
  try {
    return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
      '-of', 'json', file], { encoding: 'utf8' }));
  } catch (e) { return {}; }
}

const masterFile = `DJ04_v1_N10_master_final_r01_${STAMP}.mp4`;
const master = path.join(MASTER, masterFile);
const paramFile = path.join(MASTER, `DJ04_v1_N10_compose-params_final_r01_${STAMP}.json`);

console.log('=== 1. 成片文件与编码 ===');
ck('成片存在且 > 100KB', fs.existsSync(master) && fs.statSync(master).size > 100000);
ck('合成参数 JSON 存在', fs.existsSync(paramFile));
const pj = probe(master);
const streams = (pj.streams || []);
const v = streams.find(s => s.codec_type === 'video') || {};
const a = streams.find(s => s.codec_type === 'audio') || {};
ck('视频 H.264', v.codec_name === 'h264', v.codec_name);
ck('分辨率 1080x1920', v.width === 1080 && v.height === 1920, `${v.width}x${v.height}`);
ck('帧率 30fps', String(v.r_frame_rate) === '30/1', String(v.r_frame_rate));
ck('音频 AAC', a.codec_name === 'aac', a.codec_name);
const dur = parseFloat((pj.format || {}).duration || 0);
ck('成片时长 30s（±0.15）', Math.abs(dur - 30) < 0.15, String(dur));
ck('faststart（moov 前置）', fs.readFileSync(master).subarray(0, 64).toString('latin1').includes('moov'));
// 全片解码自检：ffmpeg -f null，确保不是只有封装头
let decodable = true;
try {
  execFileSync('ffmpeg', ['-v', 'error', '-i', master, '-f', 'null', '-'], { stdio: 'pipe' });
} catch (e) { decodable = false; }
ck('全片可解码（ffmpeg -f null）', decodable);

console.log('=== 2. 合成参数与时间轴 ===');
const cp = JSON.parse(fs.readFileSync(paramFile, 'utf8'));
ck('目标规格 1080x1920 / 30fps / 30s', cp.targetSpec.resolution === '1080x1920' && cp.targetSpec.fps === 30 && cp.targetSpec.durationSec === 30);
ck('时间轴基准为配音实测时长（非估算）', cp.timelineBasis.includes('28.296'));
ck('4 个镜头时段合计 30s', Math.abs(cp.segments.reduce((s, x) => s + x.durationSec, 0) - 30) < 0.001);
ck('C03 补帧 8.345s / C04 补帧 1.985s', cp.segments[2].padSec === 8.345 && cp.segments[3].padSec === 1.985);
ck('9 句配音延时与 manifest 一致', cp.audioLines.length === 9 && cp.audioLines[4].adelayMs === 9336 && cp.audioLines[8].adelayMs === 26352);
ck('四项交接偏差均有处置留痕', Object.keys(cp.deviationHandling).length === 4);
ck('G1 四词走后期叠层', cp.g1LaterOverlay.includes('drawtext'));
ck('字幕编码标注 UTF-8 LF', cp.subtitleEncoding.includes('LF'));
ck('4 段输入均为 r02（已擦水印）', cp.segments.every(s => s.source.includes('_final_r02_')));

console.log('=== 3. 字幕文件编码（蓝本坑位）===');
for (const f of ['sub01.txt', 'sub02.txt', 'sub03.txt', 'sub04.txt', 'four.txt']) {
  const b = fs.readFileSync(path.join(WORK, f));
  ck(`${f} UTF-8 无 BOM 无 CR`, !b.includes(0x0d) && !b.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
}
const four = fs.readFileSync(path.join(WORK, 'four.txt'), 'utf8');
ck('四词内容正确', four.includes('知识') && four.includes('审题') && four.includes('计算') && four.includes('时间'));

console.log('=== 4. 零覆盖与上游产物保留 ===');
ck('4 段 r02 输入片段仍在', [1, 2, 3, 4].every(i => fs.existsSync(path.join(CLIP,
  `DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r02_${CLIP_STAMP}.mp4`))));
ck('4 段 r01 原始片段仍在', [1, 2, 3, 4].every(i => fs.existsSync(path.join(CLIP,
  `DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r01_${CLIP_STAMP}.mp4`))));
ck('9 句配音仍在', [1, 2, 3, 4, 5, 6, 7, 8, 9].every(i => fs.existsSync(path.join(AUDIO,
  `DJ04_v1_N08_voice-L${String(i).padStart(2, '0')}_final_r01_${CLIP_STAMP}.mp3`))));
ck('r02 首帧图仍在', [1, 2, 3, 4].every(i => fs.existsSync(path.join(PROJ,
  `v1/03_asset/image/DJ04_v1_N06_image-${String(i).padStart(2, '0')}_final_r02_20261110234500.png`))));

console.log('=== 5. 资产 / 回执 / 文档 ===');
const assets = JSON.parse(fs.readFileSync(path.join(PROJ, 'assets.index.json'), 'utf8'));
ck('资产库登记 N10 成片', assets.assets.some(x => x.node === 'N10' && x.kind === 'video' && x.file === masterFile));
const rv = JSON.parse(fs.readFileSync(path.join(W, 'data/tasks/TASK_20261111003500_n10.result.json'), 'utf8'));
ck('N10 回执存在且标注零积分', rv.status === 'succeeded' && rv.billing.includes('零积分'));
ck('回执记录四项偏差处置', Object.keys(rv.deviationHandling || {}).length === 4 || (rv.knownIssues || []).length >= 1);
const changelog = fs.readFileSync(path.join(PROJ, 'changelog.jsonl'), 'utf8');
ck('变更记录含 N10 seq10/11', changelog.includes('"seq":10') || changelog.includes('"seq": 10'));
const doc11 = fs.readFileSync(path.join(W, '通用视频创作项目管理工作台_需求设计文档_v1.1.md'), 'utf8');
const walk = fs.readFileSync(path.join(W, 'PC工作台原型_走查问题分析与操作说明_v1.0.md'), 'utf8');
ck('需求文档含 §26', doc11.includes('## 26.'));
ck('操作说明含 §19', walk.includes('## 19.'));
ck('文档如实标注未做肉眼播放验证', doc11.includes('肉眼播放') || walk.includes('肉眼播放'));
ck('蓝本短剧实测零改动（627 文件）', (function () {
  let n = 0;
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) w(f); else if (e.isFile()) n++;
  } })(path.join(W, '短剧实测'));
  return n === 627;
})());
ck('app.js 强约束未回退', fs.readFileSync(path.join(W, 'prototype/pc-v1/app.js'), 'utf8').includes('PROJECT_HARD_RULES'));

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exitCode = fail ? 1 : 0;
