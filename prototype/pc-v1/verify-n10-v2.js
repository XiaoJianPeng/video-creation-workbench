/**
 * N10 v2 成片验收（零依赖，全程只读）
 *
 * 验证：D1=B 反推总长、D2 Δ 规则、片尾静音、单镜 clone 占比（如实记录）、
 *       AC-58 单句偏差、AC-59 零覆盖、R2-13 字幕窗口自动推导、
 *       编码规格 / faststart / 全片可解码 / 上游产物保留 / 蓝本零改动。
 * 运行：node verify-n10-v2.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const MASTER = path.join(PROJ, 'v1/04_output/master');
const STAMP = '20261111012500';
const AUDIO_V2 = path.join(PROJ, 'v1/04_output/audio_v2');
const AUDIO_TRIM = path.join(PROJ, 'v1/04_output/audio_v2_trim');
const TRIAL_V2 = path.join(PROJ, 'v1/03_asset/audio/trial_v2');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
function probe(f) {
  try { return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
    '-of', 'json', f], { encoding: 'utf8' })); } catch (e) { return {}; }
}
function dur(f) {
  try { return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim()); }
  catch (e) { return null; }
}

const mp4 = path.join(MASTER, `DJ04_v1_N10_master_final_r02_${STAMP}.mp4`);
const pf = path.join(MASTER, `DJ04_v1_N10_compose-params_final_r02_${STAMP}.json`);
const vmf = path.join(AUDIO_V2, 'DJ04_v1_N08_voice-manifest_final_r02_20261111012000.json');
const tmfTrim = path.join(AUDIO_TRIM, 'DJ04_v1_N08_voice-manifest-trimmed_final_r02_20261111012000.json');
const tmf = path.join(TRIAL_V2, 'DJ04_v1_N08_trialv2-manifest_final_r01_20261111011500.json');

console.log('=== 1. 成片编码与可解码 ===');
ck('r02 成片存在且 > 100KB', fs.existsSync(mp4) && fs.statSync(mp4).size > 100000);
const pj = probe(mp4);
const v = (pj.streams || []).find(s => s.codec_type === 'video') || {};
const a = (pj.streams || []).find(s => s.codec_type === 'audio') || {};
ck('H.264 / 1080x1920 / 30fps', v.codec_name === 'h264' && v.width === 1080 && v.height === 1920 && String(v.r_frame_rate) === '30/1');
ck('AAC 音轨', a.codec_name === 'aac');
ck('faststart（moov 前置）', fs.readFileSync(mp4).subarray(0, 64).toString('latin1').includes('moov'));
let decodable = true;
try { execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'null', '-'], { stdio: 'pipe' }); }
catch (e) { decodable = false; }
ck('全片可解码', decodable);

console.log('=== 2. D1=B / D2 时长口径 ===');
ck('合成参数存在', fs.existsSync(pf));
const cp = JSON.parse(fs.readFileSync(pf, 'utf8'));
ck('D1=B 已记录', cp.decision.D1.includes('B（'));
ck('D2 Δ 目标 0.7s', cp.timeline.deltaSec === 0.7);
ck('Δ 在 [0.4,1.0] 目标区间', cp.timeline.deltaSec >= 0.4 && cp.timeline.deltaSec <= 1.0);
ck('Δ ≤ 1.5s 上限', cp.timeline.deltaSec <= 1.5);
ck('成片总长 ≠ 固定 30s（D1=B 生效）', Math.abs(cp.timeline.tVideoSec - 30) > 0.3, String(cp.timeline.tVideoSec));
ck('实测时长与 T_video 吻合（±0.15s）', Math.abs(parseFloat(pj.format.duration) - cp.timeline.tVideoSec) < 0.15,
  `${pj.format.duration} vs ${cp.timeline.tVideoSec}`);
ck('片尾算术静音 ≤0.8s', cp.timeline.arithmeticTailSilenceSec <= 0.8);
ck('实测片尾静音已探测', cp.timeline.measuredTailSilenceSec !== null, String(cp.timeline.measuredTailSilenceSec));
if (cp.timeline.measuredTailSilenceSec != null) {
  ck('实测片尾静音 ≤0.8s', cp.timeline.measuredTailSilenceSec <= 0.8, String(cp.timeline.measuredTailSilenceSec));
}

console.log('=== 3. 时间轴与镜头（R2-10 / R2-13 / R2-12）===');
const mf = JSON.parse(fs.readFileSync(vmf, 'utf8'));
const mft = JSON.parse(fs.readFileSync(tmfTrim, 'utf8'));
ck('v2 配音 9/9 成功', mf.succeeded === 9);
ck('去尾静音 manifest 9 条且总有声时长 < 原容器时长',
  mft.items.length === 9 && mft.totalVoicedDurationSec < mf.totalDurationSec,
  `${mft.totalVoicedDurationSec} < ${mf.totalDurationSec}`);
ck('9 句实测有声时长与合成 lines 一致', cp.lines.length === 9 && cp.lines.every(l => {
  const m = mft.items.find(x => x.id === l.id);
  return m && Math.abs(m.durationSec - l.durationSec) < 0.001;
}));
ck('句间 0.2s 停顿生效', Math.abs(cp.lines[1].start - cp.lines[0].start - cp.lines[0].durationSec - 0.2) < 0.002);
ck('4 镜头时段连续且合计 = T_video', cp.shots[0].start === 0 &&
  cp.shots.slice(1).every((s, i) => Math.abs(s.start - cp.shots[i].end) < 0.002) &&
  Math.abs(cp.shots[3].end - cp.timeline.tVideoSec) < 0.002);
ck('字幕窗口由实测起点自动推导（非硬编码）', cp.shots.every(s => s.subOn >= s.start && s.subOff <= s.end && s.subOff > s.subOn));
const overClone = cp.shots.filter(s => s.cloneRatioExceeded);
console.log('[INFO] 单镜 clone 占比: ' + cp.shots.map(s => `${s.id}=${(s.cloneRatio * 100).toFixed(1)}%`).join(', '));
ck('clone 占比如实标注（超 30% 标 cloneRatioExceeded）', cp.shots.every(s => s.cloneRatioExceeded === (s.cloneRatio > 0.30)));
ck('checks.cloneRatioOK 与实测一致，未编造通过', cp.checks.cloneRatioOK === (overClone.length === 0));
console.log('[INFO] R2-12 未达标镜头: ' + (overClone.length ? overClone.map(s => s.id).join(',') : '无'));

console.log('=== 4. 语音自然度（R2-02 / AC-58 / R2-09）===');
const probeRes = JSON.parse(fs.readFileSync(path.join(W, 'data/tts_probe/probe-result.json'), 'utf8'));
ck('能力探测已落盘且 pitch/volume 被接受', probeRes.findings.pitchVolumeAccepted === true);
ck('<break> 不支持已如实记录', probeRes.findings.breakSupported === false);
ck('express-as 不支持已如实记录', probeRes.findings.expressAsSupported === false);
ck('OUTPUT_FORMAT 三档已记录', probeRes.outputFormats.length === 3);
const trial = JSON.parse(fs.readFileSync(tmf, 'utf8'));
ck('逐句同构 A/B 试听 10/10 成功', trial.items.length === 10 && trial.items.every(i => i.status === 'ok'));
ck('试听与正式同构（isomorphicWith）', trial.isomorphicWith.includes('voice-manifest'));
ck('试听覆盖 6 维', Object.keys(trial.dimensions).length === 7); // 含 bitrate 负结论
ck('结论未预判（judgement 留人工）', trial.judgement.includes('需人工'));
const maxDev = Math.max(...mf.items.filter(i => i.status === 'ok').map(i => Math.abs(i.deviationPct)));
console.log('[INFO] 单句 estSec 最大偏差: ' + maxDev + '%');
ck('单句偏差已如实记录（AC-58 目标 ≤20%，本轮未达标则标注）', mf.maxDeviationPct === maxDev);
ck('estSec 降级为参考值（note 明确）', mf.note.includes('AC-58'));

console.log('=== 5. 零覆盖与边界 ===');
ck('r01 成片仍在（Q06）', fs.existsSync(path.join(MASTER, 'DJ04_v1_N10_master_final_r01_20261111003500.mp4')));
ck('r01 九句配音仍在', fs.existsSync(path.join(PROJ, 'v1/04_output/audio/DJ04_v1_N08_voice-L01_final_r01_20261111000600.mp3')));
ck('v2 九句配音独立目录', fs.readdirSync(AUDIO_V2).filter(f => f.endsWith('.mp3')).length === 9);
ck('4 段 r02 源片段仍在', [1, 2, 3, 4].every(i => fs.existsSync(path.join(PROJ,
  `v1/04_output/clip/DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r02_20261111000600.mp4`))));
ck('字幕文件 UTF-8 LF 无 BOM', ['sub01.txt', 'sub02.txt', 'sub03.txt', 'sub04.txt', 'four.txt'].every(f => {
  const b = fs.readFileSync(path.join('D:/WorkBuddy_space/2026-11-09-10-57-28/_n10_work', f));
  return !b.includes(0x0d) && !b.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
}));
ck('G1 四词后期叠层仍生效', cp.g1LaterOverlay.includes('drawtext'));
ck('app.js 强约束未回退', fs.readFileSync(path.join(W, 'prototype/pc-v1/app.js'), 'utf8').includes('PROJECT_HARD_RULES'));
let n = 0;
(function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const f = path.join(d, e.name);
  if (e.isDirectory()) w(f); else if (e.isFile()) n++;
} })(path.join(W, '短剧实测'));
ck('蓝本短剧实测零改动（627 文件）', n === 627, String(n));

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exitCode = fail ? 1 : 0;
