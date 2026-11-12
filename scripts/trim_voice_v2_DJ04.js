/**
 * N08 v2 配音去尾静音预处理（R2-03 前置，零积分）。
 *
 * 问题：mp3 容器时长包含 TTS 自带的句末静音，用它累加会高估 T_audio_eff，
 *       进而把片尾连续静音撑到 1.283s（>0.8s 上限）。
 * 方案：逐句去除尾部静音（保留句首），另存 audio_v2_trim/，不覆盖 audio_v2/。
 *       重算后的「有声时长」才是 T_audio_eff 的正确基准。
 *
 * 依赖：ffmpeg / ffprobe
 * 运行：node scripts/trim_voice_v2_DJ04.js
 * 输出：v1/04_output/audio_v2_trim/*.mp3 + voice-manifest-trimmed JSON
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const SRC = path.join(PROJ, 'v1/04_output/audio_v2');
const OUT = path.join(PROJ, 'v1/04_output/audio_v2_trim');
const MF = path.join(SRC, 'DJ04_v1_N08_voice-manifest_final_r02_20261111012000.json');
const STAMP = '20261111012000';

/** 时长探测 */
function dur(f) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim());
}

/** 主流程：areverse + silenceremove + areverse 去尾静音，逐句另存 */
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(MF, 'utf8'));
  const items = [];
  for (const it of mf.items) {
    const src = path.join(SRC, it.file);
    const dst = path.join(OUT, it.file.replace('_final_r02_', '_final_r02trim_'));
    // 去尾静音：反转 → 去首部静音 → 反转回来；阈值 -45dB，保留 0.05s 自然尾音
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af',
      'areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,areverse',
      '-c:a', 'libmp3lame', '-b:a', '96k', dst]);
    const d = dur(dst);
    items.push({ ...it, file: path.basename(dst), sourceFile: it.file,
      originalDurationSec: it.durationSec, durationSec: Number(d.toFixed(3)),
      trimmedSec: Number((it.durationSec - d).toFixed(3)), bytes: fs.statSync(dst).size });
    console.log(`[OK] ${it.id} ${it.durationSec}s -> ${d.toFixed(3)}s (trim ${(it.durationSec - d).toFixed(3)}s)`);
  }
  const total = Number(items.reduce((s, i) => s + i.durationSec, 0).toFixed(3));
  const out = {
    manifestId: `VOICE_DJ04_N08_V2TRIM_${STAMP}`,
    projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N08', version: 'r02trim',
    purpose: 'N10 v2 合成的有声时长基准（去尾静音）',
    tool: '本地 ffmpeg（零积分）', billing: '零积分',
    note: 'durationSec 为去尾静音后的有声时长；句间停顿由 compose 显式插入，不依赖 mp3 自带尾静音。',
    totalLines: items.length, totalVoicedDurationSec: total,
    generatedAt: new Date().toISOString(), items
  };
  const mfOut = path.join(OUT, `DJ04_v1_N08_voice-manifest-trimmed_final_r02_${STAMP}.json`);
  fs.writeFileSync(mfOut, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[DONE] totalVoiced=${total}s (原 ${mf.totalDurationSec}s) -> ${mfOut}`);
}

try { main(); } catch (e) { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; }
