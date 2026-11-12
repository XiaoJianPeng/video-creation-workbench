/**
 * DJ04 · N08 正式配音生成（本地免费 TTS，零积分）
 *
 * 音色结论（2026-11-11 用户拍板）：妈妈 = M1 晓晓 -3%；小宇 = X2 云希 +0%。
 * 台词取自 DJ04_v1_N08_voice-01_final_r01_20261110205600.json，共 9 句。
 * 「妈妈（画外）」L09 沿用妈妈音色，后期可按需加轻微混响。
 *
 * 依赖：msedge-tts（复用蓝本 _build/tts/node_modules，无需安装；合成需联网）
 * 运行：node scripts/tts_final_DJ04.js
 * 输出：projects/P_20261110_004_DJ04/v1/04_output/audio/
 *
 * 注意：本脚本只生成配音音频，不生成字幕、不合成成片；不覆盖任何既有文件。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require(
  'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/短剧实测/_build/tts/node_modules/msedge-tts'
);

const PROJ = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/projects/P_20261110_004_DJ04';
const OUT_DIR = path.join(PROJ, 'v1/04_output/audio');
const SRC = path.join(PROJ, 'v1/04_output/subtitle/DJ04_v1_N08_voice-01_final_r01_20261110205600.json');
const STAMP = '20261111000600';
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;

/** 用户确认的音色方案（来源：2026-11-11 用户消息「妈妈=M1，小宇=X2」） */
const VOICE_MAP = {
  '妈妈': { trialId: 'M1', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 Xiaoxiao', rate: '-3%' },
  '小宇': { trialId: 'X2', voice: 'zh-CN-YunxiNeural', label: '云希 Yunxi', rate: '+0%' }
};

/**
 * 把台词里的 who 归一到音色键（「妈妈（画外）」→ 妈妈）
 * @param {string} who 清单中的角色名
 * @returns {string} 音色键
 */
function voiceKey(who) {
  return String(who).indexOf('小宇') >= 0 ? '小宇' : '妈妈';
}

/**
 * 合成单句配音并落盘
 * @param {object} tts 已绑定音色的 MsEdgeTTS 实例
 * @param {object} line 台词项
 * @param {object} cfg 音色配置
 * @returns {Promise<object>} 产物登记项
 */
async function synthLine(tts, line, cfg) {
  const file = `DJ04_v1_N08_voice-${line.id}_final_r01_${STAMP}.mp3`;
  const dest = path.join(OUT_DIR, file);
  const { audioStream } = await tts.toStream(line.text, { rate: cfg.rate });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    audioStream.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    audioStream.pipe(ws);
  });
  // ffprobe 取真实时长，供 N10 对齐字幕（失败则回退清单估算值，如实标注）
  let duration = null;
  try {
    duration = parseFloat(execFileSync('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', dest],
      { encoding: 'utf8' }).trim());
  } catch (e) { /* 探测失败保留 null，不编造 */ }
  return {
    id: line.id, shot: line.shot, who: line.who, text: line.text,
    voiceKey: voiceKey(line.who), trialId: cfg.trialId, voice: cfg.voice, rate: cfg.rate,
    file, bytes: fs.statSync(dest).size,
    durationSec: Number.isFinite(duration) ? Number(duration.toFixed(3)) : null,
    estSec: line.estSec, subtitle: line.subtitle, status: 'ok'
  };
}

/** 主流程：按音色分组 → 逐句合成 → 写配音清单与音色结论留痕 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const items = [];
  const ttsCache = {};
  // 每个音色只建一次实例；setMetadata 绑定音色，复用实例会串音色
  for (const line of src.lines) {
    const key = voiceKey(line.who);
    const cfg = VOICE_MAP[key];
    if (!ttsCache[key]) {
      const t = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 60000 });
      await t.setMetadata(cfg.voice, FORMAT);
      ttsCache[key] = t;
    }
    try {
      const r = await synthLine(ttsCache[key], line, cfg);
      items.push(r);
      console.log(`[OK] ${line.id} ${key} ${cfg.voice} ${r.bytes}B ${r.durationSec}s -> ${r.file}`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      items.push({ id: line.id, who: line.who, text: line.text, status: 'failed', error: msg });
      console.log(`[FAIL] ${line.id}: ${msg}`);
    }
  }
  const okItems = items.filter(i => i.status === 'ok');
  const manifest = {
    manifestId: `VOICE_DJ04_N08_${STAMP}`,
    projectId: 'P_20261110_004', projectCode: 'DJ04', nodeId: 'N08',
    purpose: '正式配音（音色已经用户试听确认）',
    voiceDecision: {
      decidedBy: 'user', decidedAt: new Date().toISOString(),
      raw: '妈妈=M1，小宇=X2',
      mom: VOICE_MAP['妈妈'], xiaoyu: VOICE_MAP['小宇'],
      note: 'L09「妈妈（画外）」沿用妈妈音色'
    },
    basedOn: path.basename(SRC),
    tool: 'msedge-tts（本地免费 TTS）', billing: '零积分',
    totalLines: items.length, succeeded: okItems.length,
    totalDurationSec: Number(okItems.reduce((s, i) => s + (i.durationSec || 0), 0).toFixed(3)),
    note: '实际时长由 ffprobe 探测；成片 30s，余量留给停顿、翻纸声、特写与黑屏字幕。本清单不含字幕与成片。',
    items
  };
  const mf = `DJ04_v1_N08_voice-manifest_final_r01_${STAMP}.json`;
  fs.writeFileSync(path.join(OUT_DIR, mf), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`DONE ok=${okItems.length}/${items.length} total=${manifest.totalDurationSec}s manifest=${mf}`);
  if (okItems.length === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[FATAL]', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
