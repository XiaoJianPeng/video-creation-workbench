/**
 * msedge-tts 能力探测（零积分本地 TTS，只读式实验）
 *
 * 目的：把复盘 §3 的「待验证假设」变成实测结论，不预判。
 * 探测项：
 *  ① ProsodyOptions 的 pitch / volume 是否被接受且改变输出；
 *  ② input 内嵌 <break time="..."/> 是否产生停顿（时长变化）；
 *  ③ mstts:express-as 情感风格是否被 Edge TTS 接受（可能失败，属预期负结论）；
 *  ④ OUTPUT_FORMAT 是否只有 48k/96k 两档（源码已确认，此处再核对枚举）。
 *
 * 依赖：msedge-tts（蓝本 _build/tts/node_modules）、ffprobe
 * 运行：node scripts/tts_probe_DJ04.js
 * 输出：data/tts_probe/*.mp3 + data/tts_probe/probe-result.json
 *
 * 安全：产物落在 data/tts_probe/，不覆盖任何既有配音或成片；不调用任何计费模型。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require(
  'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/短剧实测/_build/tts/node_modules/msedge-tts'
);

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const OUT = path.join(W, 'data/tts_probe');
const TEXT = '先别看分。咱把这三类分开，基础丢的、粗心丢的、没时间写的。';

/** 取 mp3 时长，失败返回 null（不编造） */
function dur(f) {
  try {
    return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim());
  } catch (e) { return null; }
}

/** 合成单个用例并落盘 */
async function synth(id, input, opts, fmt) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 60000 });
  await tts.setMetadata('zh-CN-XiaoxiaoNeural', fmt || OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(input, opts || {});
  const file = path.join(OUT, id + '.mp3');
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(file);
    audioStream.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
    audioStream.pipe(ws);
  });
  return { id, file: path.basename(file), bytes: fs.statSync(file).size, durationSec: dur(file) };
}

/** 主流程：逐用例独立实例，单项失败不中断整批 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = [
    { id: 'base', label: '基线（rate -3%）', input: TEXT, opts: { rate: '-3%' } },
    { id: 'pitch_low', label: 'pitch -2st + volume +0%', input: TEXT, opts: { rate: '-3%', pitch: '-2st', volume: '+0%' } },
    { id: 'pitch_high', label: 'pitch +2st', input: TEXT, opts: { rate: '-3%', pitch: '+2st' } },
    { id: 'break', label: '内嵌 <break time="400ms"/>', input: '先别看分。<break time="400ms"/>咱把这三类分开。', opts: { rate: '-3%' } },
    { id: 'express', label: 'mstts:express-as style="gentle"', input: '<mstts:express-as style="gentle">' + TEXT + '</mstts:express-as>', opts: { rate: '-3%' } },
    { id: 'fmt48', label: '48kbps 对照', input: TEXT, opts: { rate: '-3%' }, fmt: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 }
  ];
  const rows = [];
  for (const c of cases) {
    try {
      const r = await synth(c.id, c.input, c.opts, c.fmt);
      rows.push(Object.assign({}, c, r, { status: 'ok' }));
      console.log(`[OK] ${c.id} ${r.bytes}B ${r.durationSec}s`);
    } catch (e) {
      rows.push(Object.assign({}, c, { status: 'failed', error: String(e && e.message || e) }));
      console.log(`[FAIL] ${c.id}: ${e && e.message || e}`);
    }
  }
  const base = rows.find(r => r.id === 'base');
  const br = rows.find(r => r.id === 'break');
  const result = {
    probeId: 'TTS_PROBE_DJ04_20261111010000',
    at: new Date().toISOString(),
    tool: 'msedge-tts（本地免费，零积分）',
    outputFormats: Object.values(OUTPUT_FORMAT),
    findings: {
      pitchVolumeAccepted: rows.find(r => r.id === 'pitch_low').status === 'ok' && rows.find(r => r.id === 'pitch_high').status === 'ok',
      breakSupported: !!(base && br && base.status === 'ok' && br.status === 'ok' && br.durationSec > base.durationSec + 0.2),
      breakDeltaSec: base && br && base.durationSec != null && br.durationSec != null ? Number((br.durationSec - base.durationSec).toFixed(3)) : null,
      expressAsSupported: rows.find(r => r.id === 'express').status === 'ok',
      expressAsError: (rows.find(r => r.id === 'express') || {}).error || null,
      maxBitrateIs96k: Object.values(OUTPUT_FORMAT).length === 2,
      fmt48Bytes: (rows.find(r => r.id === 'fmt48') || {}).bytes || null,
      baseBytes: (base || {}).bytes || null
    },
    cases: rows.map(r => ({ id: r.id, label: r.label, status: r.status, bytes: r.bytes, durationSec: r.durationSec, error: r.error }))
  };
  const out = path.join(OUT, 'probe-result.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  console.log('[DONE] ' + out);
  console.log('[FINDINGS] ' + JSON.stringify(result.findings));
}

main().catch(e => { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; });
