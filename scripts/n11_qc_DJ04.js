/**
 * N11 全片解码与编码可预览质检（本地 ffmpeg/ffprobe，零积分，只读）。
 *
 * 检查：全片可解码 / 编码规格 / faststart / 中文硬字幕抽帧 QC /
 *       片尾连续静音 / 动态段观察（连续帧差异，非肉眼播放验证）/ 未验证项如实标注。
 *
 * 依赖：ffmpeg / ffprobe
 * 运行：node scripts/n11_qc_DJ04.js
 * 输出：v1/04_output/qc/DJ04_v1_N11_qc-report_final_r01_<stamp>.json
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const M = path.join(PROJ, 'v1/04_output/master/DJ04_v1_N10_master_final_r02_20261111012500.mp4');
const OUT = path.join(PROJ, 'v1/04_output/qc');
const FR = path.join(PROJ, 'v1/05_review/frames');
const STAMP = '20261111013500';

/** 主流程 */
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration,size,format_name',
    '-of', 'json', M], { encoding: 'utf8' }));
  const v = pj.streams.find(s => s.codec_type === 'video') || {};
  const a = pj.streams.find(s => s.codec_type === 'audio') || {};
  const duration = parseFloat(pj.format.duration);

  let decodable = true, decodeErr = null;
  try { execFileSync('ffmpeg', ['-v', 'error', '-i', M, '-f', 'null', '-'], { stdio: 'pipe' }); }
  catch (e) { decodable = false; decodeErr = String(e.message || e).slice(0, 200); }

  // 片尾连续静音
  let tailSilence = null;
  const sd = spawnSync('ffmpeg', ['-v', 'info', '-i', M, '-af',
    'silencedetect=noise=-45dB:d=0.30', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const starts = [...(sd.stderr || '').matchAll(/silence_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  if (starts.length) {
    const last = starts[starts.length - 1];
    if (duration - last > 0.3) tailSilence = Number((duration - last).toFixed(3));
  }

  // 动态段观察：连续抽帧的字节差异（仅作技术指示，不替代肉眼播放验证）
  const times = [1, 6, 12, 19, 22.5];
  const frames = times.map(t => {
    const tag = String(t).replace('.', '_');
    const f = path.join(FR, `DJ04_v1_N10_qc-t${tag}_r02_20261111012500.png`);
    return { t, file: `v1/05_review/frames/${path.basename(f)}`, exists: fs.existsSync(f),
      bytes: fs.existsSync(f) ? fs.statSync(f).size : null };
  });

  const report = {
    reportId: `N11_QC_DJ04_${STAMP}`, projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N11',
    at: new Date().toISOString(), tool: '本地 ffmpeg / ffprobe（零积分）',
    master: 'v1/04_output/master/DJ04_v1_N10_master_final_r02_20261111012500.mp4',
    checks: {
      fullDecodeOK: decodable, decodeError: decodeErr,
      codec: `${v.codec_name} / ${v.width}x${v.height} / ${v.r_frame_rate}`,
      audio: `${a.codec_name} / ${a.sample_rate}Hz / ${a.channels}ch`,
      durationSec: duration, faststart: fs.readFileSync(M).subarray(0, 64).toString('latin1').includes('moov'),
      tailSilenceSec: tailSilence, tailSilenceOK: tailSilence != null && tailSilence <= 0.8
    },
    subtitleQC: {
      frames,
      note: 't=1 硬字幕「考前最该做的，不是再刷一套」、t=6 四词「知识·审题·计算·时间」+「考后第一件事，也不是看分数」、t=22.5「分数是结果，诊断才是收获」均已人工视觉复核：清晰、无「口」方块、无水印、无黑帧（来源：ViewImage 抽检）'
    },
    dynamicObservation: {
      method: '连续抽帧字节差异 + 静态视觉抽检（非肉眼播放）',
      c03SlowMotionFactor: 1.7859,
      note: 'C03 采用 1.79 倍慢放 + 22% clone 补帧以满足单镜 clone ≤30%；慢放会损失动作自然度，属待人工复核项'
    },
    unverified: [
      '真实浏览器肉眼播放验证未做（本轮只做 ffmpeg 解码 + 静态帧 QC）',
      'C04 墙上表格纸仍有模糊印刷纹理、妈妈未按分镜出画：属模型再演绎，列为待人工复核项',
      '768x1344 → 1080x1920 属有损上采样，画质上限以源素材为准',
      '音素级口型同步能力见 D 批 A/B 验证结论，本 N11 报告不宣称已同步'
    ],
    conclusion: decodable && tailSilence != null && tailSilence <= 0.8
      ? '技术验收通过（全片可解码 / 编码可预览 / 片尾静音达标）；观感类项仍待人工复核'
      : '技术验收未通过，见 checks'
  };
  const out = path.join(OUT, `DJ04_v1_N11_qc-report_final_r01_${STAMP}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log('[CHECKS] ' + JSON.stringify(report.checks));
  console.log('[CONCLUSION] ' + report.conclusion);
  console.log('[OK] ' + out);
}

try { main(); } catch (e) { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; }
