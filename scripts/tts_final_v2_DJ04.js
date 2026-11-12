/**
 * N08 正式配音 v2（零积分本地 TTS），落实 R2-02 中不依赖人工试听结论的调整项。
 *
 * 保持不变（用户已拍板，不擅自改）：妈妈 = M1 zh-CN-XiaoxiaoNeural -3%，小宇 = X2 zh-CN-YunxiNeural +0%。
 * 本轮落地：
 *  ① 标点预处理：去掉「……」、把「——」改冒号，避免省略号被逐字读出或产生异常停顿；
 *  ② 同角色共用同一 MsEdgeTTS 实例与统一参数（连贯性，脚本已具备）；
 *  ③ 句间停顿由 compose_n10_v2 的 adelay 显式插入 0.2s（不在 TTS 内嵌 SSML，实测不支持）；
 *  ④ 情感表达只由已确认支持的 rate/pitch/volume 组合承载，本版 pitch/volume 取 default
 *     （具体情感档位需用户 A/B 试听后另行拍板，不预判）。
 *  ⑤ 码率维度：96k mp3 已是该库 mp3 最高档（探测结论），不调整。
 *
 * 依赖：msedge-tts（蓝本 _build/tts/node_modules）、ffprobe
 * 运行：node scripts/tts_final_v2_DJ04.js
 * 输出：v1/04_output/audio_v2/（新目录，不覆盖 r01 九句）
 * 边界：音色/情感档位的最终选择仍需人工 A/B 试听，本版为保守基线。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require(
  'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/短剧实测/_build/tts/node_modules/msedge-tts'
);

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const OUT = path.join(PROJ, 'v1/04_output/audio_v2');
const SRC = path.join(PROJ, 'v1/04_output/audio/DJ04_v1_N08_voice-manifest_final_r01_20261111000600.json');
const STAMP = '20261111012000';

/** 用户确认的音色方案（2026-11-11「妈妈=M1，小宇=X2」） */
const VOICE_MAP = {
  '妈妈': { trialId: 'M1', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 Xiaoxiao', rate: '-3%' },
  '小宇': { trialId: 'X2', voice: 'zh-CN-YunxiNeural', label: '云希 Yunxi', rate: '+0%' }
};

/** 台词预处理：省略号去掉、破折号改冒号；不改变语义与台词内容 */
function normalizeText(t) {
  return String(t).replace(/…+/g, '').replace(/——/g, '：').replace(/^[：\s]+/, '').trim();
}
function voiceKey(who) { return String(who).indexOf('小宇') >= 0 ? '小宇' : '妈妈'; }
function dur(f) {
  try { return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim()); }
  catch (e) { return null; }
}

/** 主流程：9 句逐句合成，同角色共用一个实例；另存 audio_v2 不覆盖 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const items = [];
  const cache = {};
  for (const line of src.items) {
    const key = voiceKey(line.who);
    const cfg = VOICE_MAP[key];
    try {
      if (!cache[key]) {
        const t = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 60000 });
        await t.setMetadata(cfg.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        cache[key] = t;
      }
      const text = normalizeText(line.text);
      const { audioStream } = await cache[key].toStream(text, { rate: cfg.rate });
      const chunks = [];
      for await (const c of audioStream) chunks.push(c);
      const file = `DJ04_v1_N08_voice-${line.id}_final_r02_${STAMP}.mp3`;
      const dest = path.join(OUT, file);
      fs.writeFileSync(dest, Buffer.concat(chunks));
      const d = dur(dest);
      items.push({ id: line.id, shot: line.shot, who: line.who, text: line.text, ttsText: text,
        voiceKey: key, trialId: cfg.trialId, voice: cfg.voice, rate: cfg.rate,
        file, bytes: fs.statSync(dest).size, durationSec: d, estSec: line.estSec,
        deviationPct: line.estSec ? Number(((d - line.estSec) / line.estSec * 100).toFixed(1)) : null,
        subtitle: line.subtitle, status: 'ok' });
      console.log(`[OK] ${line.id} ${key} ${d}s est=${line.estSec}s dev=${items[items.length-1].deviationPct}% | ${text}`);
    } catch (e) {
      items.push({ id: line.id, who: line.who, status: 'failed', error: String(e && e.message || e) });
      console.log(`[FAIL] ${line.id}: ${e && e.message || e}`);
    }
  }
  const ok = items.filter(i => i.status === 'ok');
  const manifest = {
    manifestId: `VOICE_DJ04_N08_V2_${STAMP}`,
    projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N08', version: 'r02',
    purpose: '正式配音 v2（标点预处理 + 同角色连贯性）；音色/情感档位保持用户已确认值',
    tool: 'msedge-tts（本地免费 TTS）', billing: '零积分',
    voiceDecision: { decidedBy: 'user', raw: '妈妈=M1，小宇=X2', mom: VOICE_MAP['妈妈'], xiaoyu: VOICE_MAP['小宇'] },
    adjustments: {
      punctuationNormalized: true,
      sameRoleSharedInstance: true,
      explicitInterSentencePauseSec: 0.2,
      pauseImplementedBy: 'compose_n10_v2 的 adelay（内嵌 SSML <break> 实测不可用）',
      pitchVolume: 'default（待人工 A/B 试听后拍板，不预判）',
      bitrate: '96k mp3（该库 mp3 最高档，探测确认，无可提升）'
    },
    capabilityProbe: 'data/tts_probe/probe-result.json',
    totalLines: items.length, succeeded: ok.length,
    totalDurationSec: Number(ok.reduce((s, i) => s + (i.durationSec || 0), 0).toFixed(3)),
    maxDeviationPct: Math.max(...ok.map(i => Math.abs(i.deviationPct || 0))),
    note: 'deviationPct 为单句实测与清单 estSec 的偏差；AC-58 目标 ≤20%，超出需如实标注。',
    generatedAt: new Date().toISOString(), items
  };
  fs.writeFileSync(path.join(OUT, `DJ04_v1_N08_voice-manifest_final_r02_${STAMP}.json`),
    JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`DONE ok=${ok.length}/${items.length} total=${manifest.totalDurationSec}s maxDev=${manifest.maxDeviationPct}%`);
  if (ok.length === 0) process.exitCode = 1;
}

main().catch(e => { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; });
