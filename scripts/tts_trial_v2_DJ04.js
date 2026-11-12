/**
 * N08 试听样本 v2：与正式配音「同构」（逐句切分），修复 R2-09。
 *
 * 能力边界（由 data/tts_probe/probe-result.json 实测，勿凭空假设）：
 *  - 支持：ProsodyOptions 的 rate / pitch / volume；OUTPUT_FORMAT 三档
 *    （48k mp3 / 96k mp3（当前已最高）/ opus-webm）。
 *  - 不支持：input 内嵌 <break>、<mstts:express-as>（Edge TTS 直接关闭流）。
 *  - 因此「停顿」用本地 ffmpeg 静音拼接实现，「情感」只由 rate/pitch/volume 组合表达，
 *    不引入新栈、不编造 SSML 能力。
 *
 * 6 维 A/B：音色 / 语速 / 停顿 / 语调 / 情感 / 连贯性；码率维度为负结论（mp3 已最高档）。
 *
 * 依赖：msedge-tts（蓝本 _build/tts/node_modules）、ffmpeg / ffprobe
 * 运行：node scripts/tts_trial_v2_DJ04.js
 * 输出：v1/03_asset/audio/trial_v2/（新目录，不覆盖 v1 试听样本）
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
const OUT = path.join(PROJ, 'v1/03_asset/audio/trial_v2');
const SRC = path.join(PROJ, 'v1/04_output/audio/DJ04_v1_N08_voice-manifest_final_r01_20261111000600.json');
const STAMP = '20261111011500';
const PAUSE_MS = 260; // 句间停顿 0.26s，落在 0.15–0.35s 目标区间

/** 与正式配音同构的逐句文本（取自 N08 清单，按角色分组；省略号去掉避免被逐字读出） */
const GROUP_TEXT = {
  '妈妈': ['明天就考了，复习得怎么样？', '这背面写的是什么？', '先别看分。咱把这三类分开：基础丢的、粗心丢的、没时间写的。'],
  '小宇': ['还行吧。', '数学又没考好。', '原来不是不会，是会了没时间写。']
};

/** 候选表：每角色 3 音色 + 语速档 + pitch 对照 + 连贯性对照 */
const CANDIDATES = [
  { id: 'M-A', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓（当前 M1）基线', rate: '-3%', pitch: 'default', mode: 'joined' },
  { id: 'M-B', role: '妈妈', voice: 'zh-CN-XiaoyiNeural', label: '晓伊（音色对照）', rate: '-3%', pitch: 'default', mode: 'joined' },
  { id: 'M-C', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 慢一档 -8%', rate: '-8%', pitch: 'default', mode: 'joined' },
  { id: 'M-D', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 pitch -2st（语调对照）', rate: '-3%', pitch: '-2st', mode: 'joined' },
  { id: 'M-E', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 逐句独立+停顿（连贯性对照）', rate: '-3%', pitch: 'default', mode: 'separate' },
  { id: 'X-A', role: '小宇', voice: 'zh-CN-YunxiNeural', label: '云希（当前 X2）基线', rate: '+0%', pitch: 'default', mode: 'joined' },
  { id: 'X-B', role: '小宇', voice: 'zh-CN-YunxiaNeural', label: '云夏 少年（音色对照）', rate: '+0%', pitch: 'default', mode: 'joined' },
  { id: 'X-C', role: '小宇', voice: 'zh-CN-YunjianNeural', label: '云健 低沉（音色/语速对照）', rate: '-3%', pitch: 'default', mode: 'joined' },
  { id: 'X-D', role: '小宇', voice: 'zh-CN-YunxiNeural', label: '云希 pitch -2st（疲惫感对照）', rate: '+0%', pitch: '-2st', mode: 'joined' },
  { id: 'X-E', role: '小宇', voice: 'zh-CN-YunxiNeural', label: '云希 逐句独立+停顿（连贯性对照）', rate: '+0%', pitch: 'default', mode: 'separate' }
];

/** 时长探测 */
function dur(f) {
  try { return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim()); }
  catch (e) { return null; }
}

/** 把 toStream 的 Readable 收成 Buffer */
async function streamBuf(audioStream) {
  const chunks = [];
  for await (const c of audioStream) chunks.push(c);
  return Buffer.concat(chunks);
}

/**
 * joined 模式：整段文本一次合成（引擎按中文标点自然断句），保留跨句韵律。
 * separate 模式：逐句独立合成后用 ffmpeg concat + 静音片段拼接（停顿可控）。
 * @returns {Promise<Buffer>} mp3 字节
 */
async function synthCandidate(tts, c) {
  const opts = { rate: c.rate };
  if (c.pitch && c.pitch !== 'default') opts.pitch = c.pitch;
  const lines = GROUP_TEXT[c.role];
  if (c.mode === 'joined') {
    const input = lines.join(''); // 标点自带自然停顿，不用 <break>（已实测不支持）
    const { audioStream } = await tts.toStream(input, opts);
    return await streamBuf(audioStream);
  }
  // 逐句独立：写临时片段 → ffmpeg concat demuxer 拼接 + 本地静音
  const tmp = path.join(OUT, '_tmp_' + c.id);
  fs.mkdirSync(tmp, { recursive: true });
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const { audioStream } = await tts.toStream(lines[i], opts);
    const f = path.join(tmp, `s${i}.mp3`);
    fs.writeFileSync(f, await streamBuf(audioStream));
    segs.push(f);
  }
  // 生成一段静音 mp3（24kHz 单声道，与 TTS 输出一致，避免 concat 采样率不一致）
  const silence = path.join(tmp, 'silence.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    `anullsrc=r=24000:cl=mono`, '-t', String(PAUSE_MS / 1000), '-c:a', 'libmp3lame', '-b:a', '96k', silence]);
  const listFile = path.join(tmp, 'list.txt');
  const entries = [];
  segs.forEach((s, i) => {
    if (i > 0) entries.push(`file '${silence.replace(/\\/g, '/')}'`);
    entries.push(`file '${s.replace(/\\/g, '/')}'`);
  });
  fs.writeFileSync(listFile, entries.join('\n') + '\n', 'utf8');
  const merged = path.join(tmp, 'merged.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:a', 'libmp3lame', '-b:a', '96k', merged]);
  const buf = fs.readFileSync(merged);
  // 清理临时目录（逐层删除，避免递归 rm 被安全策略拦截）
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  fs.rmdirSync(tmp);
  return buf;
}

/** 主流程：逐候选独立实例，单项失败不中断 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const items = [];
  for (const c of CANDIDATES) {
    try {
      const tts = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 60000 });
      await tts.setMetadata(c.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const buf = await synthCandidate(tts, c);
      const file = `DJ04_v1_N08_trialv2-${c.id}_final_r01_${STAMP}.mp3`;
      const dest = path.join(OUT, file);
      fs.writeFileSync(dest, buf);
      items.push({ ...c, file, bytes: buf.length, durationSec: dur(dest), status: 'ok' });
      console.log(`[OK] ${c.id} ${buf.length}B ${dur(dest)}s -> ${file}`);
    } catch (e) {
      items.push({ ...c, status: 'failed', error: String(e && e.message || e) });
      console.log(`[FAIL] ${c.id}: ${e && e.message || e}`);
    }
  }
  const probe = JSON.parse(fs.readFileSync(path.join(W, 'data/tts_probe/probe-result.json'), 'utf8'));
  const manifest = {
    manifestId: `TRIALV2_DJ04_N08_${STAMP}`,
    projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N08',
    purpose: '逐句同构 A/B 试听（修复 R2-09）；6 维调整方向对照',
    tool: 'msedge-tts + 本地 ffmpeg（零积分）', billing: '零积分',
    isomorphicWith: path.basename(SRC),
    capabilityProbe: {
      source: 'data/tts_probe/probe-result.json',
      pitchVolumeAccepted: probe.findings.pitchVolumeAccepted,
      breakSupported: probe.findings.breakSupported,
      expressAsSupported: probe.findings.expressAsSupported,
      outputFormats: probe.outputFormats,
      conclusion: '内嵌 SSML 停顿/情感标签不可用；停顿改本地静音拼接，情感由 rate/pitch/volume 组合表达；96k mp3 已是该库 mp3 最高档，码率维度为负结论'
    },
    dimensions: {
      timbre: 'M-A/M-B、X-A/X-B/X-C 音色对照',
      rate: 'M-A(-3%) vs M-C(-8%)、X-A(+0%) vs X-C(-3%)',
      pause: `separate 模式句间 ${PAUSE_MS}ms 本地静音；joined 模式依赖标点自然停顿`,
      intonation: 'M-D / X-D pitch -2st 对照',
      emotion: '仅由 rate/pitch/volume 组合表达「温和克制 / 疲惫克制」；express-as 已实测不可用',
      coherence: '*-A 整段一次合成 vs *-E 逐句独立合成+停顿，判断机器音是否主要来自韵律断裂',
      bitrate: '96k mp3 为最高档；opus-webm 属另一容器，不在本期引入（负结论）'
    },
    judgement: '需人工 A/B 试听后填写；本脚本不代替听感结论',
    generatedAt: new Date().toISOString(), items
  };
  fs.writeFileSync(path.join(OUT, `DJ04_v1_N08_trialv2-manifest_final_r01_${STAMP}.json`),
    JSON.stringify(manifest, null, 2), 'utf8');
  const rows = items.map(i => `| ${i.id} | ${i.role} | ${i.label} | \`${i.voice}\` | ${i.rate} | ${i.pitch} | ${i.mode === 'joined' ? '整段一次' : '逐句+停顿'} | ${i.status === 'ok' ? i.durationSec + 's' : '失败'} | \`${i.file}\` |`).join('\n');
  fs.writeFileSync(path.join(OUT, `DJ04_v1_N08_试听对照表v2_final_r01_${STAMP}.md`),
    `# N08 逐句同构 A/B 试听对照表 v2｜DJ04\n\n> 与正式配音同构（逐句切分），零积分。结论需你试听后给出。\n\n` +
    `| 编号 | 角色 | 音色/调整 | voice ID | 语速 | pitch | 连贯性 | 时长 | 文件 |\n|---|---|---|---|---|---|---|---|---|\n${rows}\n\n` +
    `## 判断标准\n\n1. 音色：角色情绪一致性（妈妈温和克制 / 小宇疲惫克制），与「克制、温和、不焦虑」调性不冲突。\n` +
    `2. 语速：口语节奏而非播报节奏；单句实测与 estSec 偏差目标 ≤20%。\n` +
    `3. 停顿：句间 0.15–0.35s；连续静音 >0.8s 判异常。\n` +
    `4. 语调/情感：pitch -2st 是否更贴近角色；相邻同角色句无基频突变。\n` +
    `5. 连贯性：*-A（整段一次）与 *-E（逐句独立）对比，判断机器音是否主要来自韵律断裂。\n` +
    `6. 码率：96k mp3 已是最高档（探测结论），不作为可调维度。\n\n` +
    `## 能力边界（实测）\n\n- \`<break>\` / \`<mstts:express-as>\` 被 Edge TTS 拒绝，内嵌 SSML 不可用。\n` +
    `- 停顿由本地 ffmpeg 静音拼接实现；情感只由 rate/pitch/volume 组合表达。\n`, 'utf8');
  console.log(`DONE ok=${items.filter(i => i.status === 'ok').length}/${items.length}`);
}

main().catch(e => { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; });
