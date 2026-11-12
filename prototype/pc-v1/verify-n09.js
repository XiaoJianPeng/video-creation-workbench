/**
 * N08 正式配音 + N09 图生视频验收脚本（零依赖，全程只读）
 *
 * 验证：音色结论留痕 / 9 句配音真实可解码 / 4 段视频 r01+r02 齐全 /
 *       r02 编码参数与 faststart / QC 帧存在 / 资产登记 / 回执 / 文档 /
 *       零覆盖（r01 与 r02 图均保留）/ 蓝本零改动。
 *
 * 运行：node verify-n09.js
 * 说明：本脚本不调用任何模型、不消耗积分、不做任何写操作。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const CLIP = path.join(PROJ, 'v1/04_output/clip');
const AUDIO = path.join(PROJ, 'v1/04_output/audio');
const FRAMES = path.join(PROJ, 'v1/05_review/frames');
const STAMP = '20261111000600';

let pass = 0, fail = 0;
/** 单条断言 */
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
/** ffprobe 取单一字段 */
function probe(file, entries, stream) {
  try {
    const args = ['-v', 'error'];
    if (stream) args.push('-select_streams', stream);
    args.push('-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', file);
    return execFileSync('ffprobe', args, { encoding: 'utf8' }).trim();
  } catch (e) { return ''; }
}

console.log('=== 1. N08 音色结论与正式配音 ===');
const mfPath = path.join(AUDIO, `DJ04_v1_N08_voice-manifest_final_r01_${STAMP}.json`);
ck('配音清单存在', fs.existsSync(mfPath));
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
ck('音色结论原始语句留痕', (mf.voiceDecision || {}).raw === '妈妈=M1，小宇=X2');
ck('妈妈 = M1 晓晓 -3%', mf.voiceDecision.mom.trialId === 'M1' && mf.voiceDecision.mom.voice === 'zh-CN-XiaoxiaoNeural' && mf.voiceDecision.mom.rate === '-3%');
ck('小宇 = X2 云希 +0%', mf.voiceDecision.xiaoyu.trialId === 'X2' && mf.voiceDecision.xiaoyu.voice === 'zh-CN-YunxiNeural' && mf.voiceDecision.xiaoyu.rate === '+0%');
ck('9 句全部成功', mf.items.length === 9 && mf.items.every(x => x.status === 'ok'));
ck('标注零积分', (mf.billing || '').includes('零积分'));
ck('L09 沿用妈妈音色', mf.items.find(x => x.id === 'L09').voiceKey === '妈妈');
ck('实测总时长 28.296s（非估算值）', mf.totalDurationSec === 28.296);
let voiceOK = true;
for (const it of mf.items) {
  const f = path.join(AUDIO, it.file);
  if (!fs.existsSync(f) || fs.statSync(f).size !== it.bytes) { voiceOK = false; break; }
  const dur = parseFloat(probe(f, 'format=duration'));
  if (!(Math.abs(dur - it.durationSec) < 0.05)) { voiceOK = false; break; }
}
ck('9 个 mp3 存在、字节吻合、时长可解码且与清单一致', voiceOK);

console.log('=== 2. N09 视频产物 ===');
for (let i = 1; i <= 4; i++) {
  const ii = String(i).padStart(2, '0');
  const r1 = path.join(CLIP, `DJ04_v1_N09_clip-${ii}_final_r01_${STAMP}.mp4`);
  const r2 = path.join(CLIP, `DJ04_v1_N09_clip-${ii}_final_r02_${STAMP}.mp4`);
  ck(`C${ii} r01 原始片段保留（零覆盖）`, fs.existsSync(r1) && fs.statSync(r1).size > 100000);
  ck(`C${ii} r02 交付片段存在`, fs.existsSync(r2) && fs.statSync(r2).size > 100000);
  const v = probe(r2, 'stream=codec_name,width,height,r_frame_rate', 'v:0').split('\n').map(s => s.trim());
  ck(`C${ii} H.264 / 768x1344 / 24fps`, v.includes('h264') && v.includes('768') && v.includes('1344') && v.includes('24/1'), v.join(','));
  const dur = parseFloat(probe(r2, 'format=duration'));
  ck(`C${ii} 时长 ≈5.17s`, Math.abs(dur - 5.166667) < 0.1, String(dur));
  ck(`C${ii} 含音轨（需 N10 静音）`, probe(r2, 'stream=codec_type', 'a:0').includes('audio'));
  const moov = fs.readFileSync(r2).subarray(0, 64).toString('latin1');
  ck(`C${ii} faststart（moov 前置）`, moov.indexOf('moov') >= 0);
  ck(`C${ii} r02 QC 帧存在`, fs.existsSync(path.join(FRAMES, `DJ04_v1_N09_qc-${ii}_mid_r02_${STAMP}.png`)));
}
ck('r01 原始 QC 帧亦保留', [1, 2, 3, 4].every(i => fs.existsSync(path.join(FRAMES, `DJ04_v1_N09_qc-${String(i).padStart(2, '0')}_mid_r01_${STAMP}.png`))));

console.log('=== 3. 资产 / 回执 / 文档 ===');
const assets = JSON.parse(fs.readFileSync(path.join(PROJ, 'assets.index.json'), 'utf8'));
// 资产库随 R2 整批继续增长（新增 clip_ab 报告等），按 kind=video 过滤 N09 片段，不按节点总数断言
const n09videos = assets.assets.filter(a => a.node === 'N09' && a.kind === 'video');
ck('N09 视频片段登记 8 条（r01 4 + r02 4）', n09videos.length === 8, String(n09videos.length));
ck('N08 登记 9 条', assets.assets.filter(a => a.node === 'N08').length === 9);
ck('仅 r02 视频片段标记为可交付', n09videos.filter(a => a.deliverable === true).length === 4);
ck('r02 视频片段均标注 G1/G2', n09videos.filter(a => a.rev === 'r02' && Array.isArray(a.hardRules) && a.hardRules.join(',') === 'G1,G2').length === 4);
const rv = JSON.parse(fs.readFileSync(path.join(W, 'data/tasks/TASK_20261111000600_video.result.json'), 'utf8'));
ck('视频回执 4 段且标注 G2 delogo 处置', rv.clips.length === 4 && rv.g2Note.includes('delogo'));
ck('回执如实记录 4 项已知偏差', rv.knownIssues.length === 4);
ck('回执标注积分未经核实', rv.billing.includes('未经核实'));
const rv2 = JSON.parse(fs.readFileSync(path.join(W, 'data/tasks/TASK_20261111000600_voice.result.json'), 'utf8'));
ck('配音回执 9 条 + 28.296s', rv2.artifacts === 9 && rv2.totalDurationSec === 28.296);
const changelog = fs.readFileSync(path.join(PROJ, 'changelog.jsonl'), 'utf8');
ck('变更记录含 seq7/8/9', ['"seq":7', '"seq":8', '"seq":9'].every(s => changelog.includes(s)) || ['"seq": 7', '"seq": 8', '"seq": 9'].every(s => changelog.includes(s)));
const doc11 = fs.readFileSync(path.join(W, '通用视频创作项目管理工作台_需求设计文档_v1.1.md'), 'utf8');
const walk = fs.readFileSync(path.join(W, 'PC工作台原型_走查问题分析与操作说明_v1.0.md'), 'utf8');
ck('需求文档 §25 含 G2 视频补强条款', doc11.includes('## 25.') && doc11.includes('§24 G2 补充条款'));
ck('需求文档如实列出已知偏差', doc11.includes('已知偏差（如实记录，不编造通过）'));
ck('操作说明 §18 含 N10 交接偏差', walk.includes('## 18.') && walk.includes('必须交接给 N10'));
ck('N09 提示词文件存在且含 G1/G2', fs.existsSync(path.join(PROJ, 'v1/02_prompt/video/DJ04_v1_N09_prompt-01_final_r01_20261111000600.md')) &&
  fs.readFileSync(path.join(PROJ, 'v1/02_prompt/video/DJ04_v1_N09_prompt-01_final_r01_20261111000600.md'), 'utf8').includes('项目强约束'));

console.log('=== 4. 零写入边界 ===');
ck('首帧 r02 四张图仍保留', [1, 2, 3, 4].every(i => fs.existsSync(path.join(PROJ, `v1/03_asset/image/DJ04_v1_N06_image-${String(i).padStart(2, '0')}_final_r02_20261110234500.png`))));
ck('蓝本短剧实测文件数 627（零改动）', (function () {
  let n = 0;
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) w(f); else if (e.isFile()) n++;
    }
  })(path.join(W, '短剧实测'));
  return n === 627;
})());
ck('app.js 仍保留强约束（未回退）', fs.readFileSync(path.join(W, 'prototype/pc-v1/app.js'), 'utf8').includes('PROJECT_HARD_RULES'));

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exitCode = fail ? 1 : 0;
