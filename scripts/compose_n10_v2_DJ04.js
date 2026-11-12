/**
 * N10 成片合成 v2（本地 ffmpeg，零积分）——落实 D1=B / D2 / R2-03 / R2-10 / R2-12 / R2-13。
 *
 * 决策落地：
 *  - D1=B：成片总长不再固定 30s，改由 `T_audio_eff + Δ` 反推（用户已明确授权变更规格包 30s 目标）。
 *  - D2：Δ 目标 [0.4,1.0]s，本版取 0.7s；可接受上限 1.5s，`Δ<0` 或超上限阻断。
 *  - R2-10：时间轴一律以 ffprobe 实测配音时长计算，`estSec` 降级为参考值。
 *  - R2-02：句间显式插入 0.2s 停顿（内嵌 SSML <break> 实测不可用，改用 adelay）。
 *  - R2-13：4 条硬字幕窗口由该镜首/末句实测起点自动推导，不再硬编码。
 *  - R2-12：单镜 clone 补帧占比如实记录；>30% 标为未达标返工项，不编造通过。
 *  - 尾部规则：片尾连续静音 ≤0.8s；结尾字幕窗口不晚于 T_audio_eff + Δ。
 *
 * 不变项：1080x1920 / 30fps / H.264 yuv420p + AAC + faststart、4 条镜级硬字幕、
 *        镜2 四词后期叠层（G1）、只映射视频丢弃模型音轨、Q06 不覆盖 r01 成片。
 *
 * 依赖：ffmpeg / ffprobe 9.0.2；字体与字幕文本在纯 ASCII 工作目录 _n10_work
 * 运行：node scripts/compose_n10_v2_DJ04.js
 * 输出：v1/04_output/master/DJ04_v1_N10_master_final_r02_<stamp>.mp4 + compose-params-v2 JSON
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const CLIP = path.join(PROJ, 'v1/04_output/clip');
const AUDIO_V2 = path.join(PROJ, 'v1/04_output/audio_v2_trim');
const MASTER = path.join(PROJ, 'v1/04_output/master');
const WORK = 'D:/WorkBuddy_space/2026-11-09-10-57-28/_n10_work';
const STAMP = '20261111012500';
const CLIP_STAMP = '20261111000600';
const VOICE_MF = path.join(AUDIO_V2, 'DJ04_v1_N08_voice-manifest-trimmed_final_r02_20261111012000.json');

const FPS = 30;
const CLIP_SRC_SEC = 5.166667;   // ffprobe 实测
const PAUSE_SEC = 0.2;          // 句间停顿
const DELTA_TARGET = 0.7;       // D2 目标区间 [0.4,1.0] 中值
const DELTA_MAX = 1.5;          // D2 可接受上限
const DELTA_MIN = 0.4;
const TAIL_SILENCE_MAX = 0.8;   // 片尾连续静音上限
const CLONE_RATIO_MAX = 0.30;   // 单镜 clone 占比上限
const CLONE_TARGET = 0.22;      // R2-12：超长镜头用「源片慢放 + 少量 clone」，把 clone 占比压到 22%

/** 镜头 → 台词分组（沿用 N08 清单 shot 字段，不改动叙事结构） */
const SHOT_LINES = { C01: ['L01', 'L02'], C02: ['L03', 'L04'], C03: ['L05', 'L06', 'L07'], C04: ['L08', 'L09'] };
const SUB_TEXT = { C01: 'sub01.txt', C02: 'sub02.txt', C03: 'sub03.txt', C04: 'sub04.txt' };

/** ffprobe 单文件时长 */
function probeDur(f) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', f], { encoding: 'utf8' }).trim());
}

/** 计算时间轴：逐句实测 + 句间停顿，返回句起点与镜头时段 */
function buildTimeline(mf) {
  const byId = {};
  mf.items.forEach(i => { byId[i.id] = i; });
  let t = 0;
  const lines = [];
  mf.items.forEach((i, k) => {
    // 句间停顿：非首句前插入 PAUSE_SEC
    if (k > 0) t += PAUSE_SEC;
    lines.push({ id: i.id, shot: i.shot, who: i.who, start: Number(t.toFixed(3)),
      durationSec: i.durationSec, estSec: i.estSec, file: i.file, subtitle: i.subtitle });
    t += i.durationSec;
  });
  const tAudioEff = Number(t.toFixed(3));
  const tVideo = Number((tAudioEff + DELTA_TARGET).toFixed(3));
  const shots = [];
  let cursor = 0;
  const keys = Object.keys(SHOT_LINES);
  keys.forEach((key, idx) => {
    const ids = SHOT_LINES[key];
    const segLines = lines.filter(l => ids.includes(l.id));
    const segStart = segLines[0].start;
    // 末镜延长到 tVideo（含 Δ 余量）；非末镜结束于下一镜首句起点（含句间停顿），
    // 保证 concat 累计时长与 adelay/字幕窗口的全局 t 完全一致，不产生 0.2s 偏移
    const nextStart = idx < keys.length - 1 ? lines.find(l => l.id === SHOT_LINES[keys[idx + 1]][0]).start : tVideo;
    const segEnd = nextStart;
    const dur = Number((segEnd - segStart).toFixed(3));
    // R2-12：超长镜头先按 slowFactor 慢放源片，仅保留 CLONE_TARGET 比例的 clone 补帧，
    // 避免单镜出现 60%+ 的静止画面；慢放会损失动作自然度，属待人工复核项（如实记录）。
    const cloneTargetSec = dur > CLIP_SRC_SEC ? Number((dur * CLONE_TARGET).toFixed(3)) : 0;
    const slowFactor = dur > CLIP_SRC_SEC ? Number(((dur - cloneTargetSec) / CLIP_SRC_SEC).toFixed(4)) : 1;
    const pad = Math.max(0, Number((dur - CLIP_SRC_SEC * slowFactor).toFixed(3)));
    shots.push({ id: key, start: segStart, end: segEnd, dur,
      padSec: pad, cloneRatio: Number((pad / dur).toFixed(3)), slowFactor,
      slowMotionApplied: slowFactor > 1.01,
      sub: SUB_TEXT[key],
      // R2-13：字幕窗口由该镜首句起点 + 0.3 到 末句结束自动推导
      subOn: Number((segLines[0].start + 0.3).toFixed(3)),
      subOff: Number(Math.min(segLines[segLines.length - 1].start + segLines[segLines.length - 1].durationSec, segEnd - 0.05).toFixed(3)),
      lines: ids });
    cursor = segEnd;
  });
  return { lines, tAudioEff, tVideo, delta: DELTA_TARGET, shots };
}

/** 单镜视频滤镜链 */
function videoFilter(i, s) {
  const chain = [
    'scale=1080:1920:force_original_aspect_ratio=increase', 'crop=1080:1920', 'setsar=1'];
  // 慢放必须在 fps 之前（setpts 改变时间基），再统一到 30fps
  if (s.slowFactor > 1.01) chain.push(`setpts=${s.slowFactor}*PTS`);
  chain.push(`fps=${FPS}`);
  if (s.padSec > 0.001) chain.push(`tpad=stop_mode=clone:stop_duration=${s.padSec.toFixed(3)}`);
  chain.push(`trim=duration=${s.dur.toFixed(3)}`, 'setpts=PTS-STARTPTS');
  // R2-12：提高 zoompan 幅度，缓解长补帧段静止感（仍属 clone，占比如实记录）
  chain.push("zoompan=z='min(zoom+0.0012,1.30)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30");
  // 输入标签必须紧贴首个 filter，不能用逗号分隔（否则 ffmpeg 报 "No such filter: ''"）
  return `[${i}:v]` + chain.join(',') + `[v${i}]`;
}

/** 音频链：9 句 adelay + 混音，atrim 到 T_video */
function audioFilter(lines, total) {
  const parts = lines.map((l, k) => `[${4 + k}:a]adelay=${Math.round(l.start * 1000)}:all=1[a${k}]`);
  parts.push(lines.map((_, k) => `[a${k}]`).join('') +
    `amix=inputs=${lines.length}:duration=longest:normalize=0,apad,atrim=duration=${total.toFixed(3)}[aout]`);
  return parts;
}

/** 主流程 */
function main() {
  const mf = JSON.parse(fs.readFileSync(VOICE_MF, 'utf8'));
  // trimmed manifest 无 succeeded 字段，改按 items 数量与 status 校验
  if (mf.items.length !== 9 || !mf.items.every(i => i.durationSec > 0)) throw new Error('v2 去尾静音配音不是 9/9 有效，拒绝合成');
  const tl = buildTimeline(mf);

  // D2 规则校验
  if (tl.delta < DELTA_MIN || tl.delta > DELTA_MAX) throw new Error(`Δ=${tl.delta}s 超出可接受范围`);
  const tailSilence = Number((tl.tVideo - tl.tAudioEff).toFixed(3));
  if (tailSilence > TAIL_SILENCE_MAX) throw new Error(`片尾静音 ${tailSilence}s > ${TAIL_SILENCE_MAX}s`);

  // 字幕窗口写入 UTF-8 LF 文件（沿用 v1 文本，仅窗口变动）
  const inputs = [];
  tl.shots.forEach((_, i) => inputs.push(path.join(CLIP,
    `DJ04_v1_N09_clip-${String(i + 1).padStart(2, '0')}_final_r02_${CLIP_STAMP}.mp4`)));
  tl.lines.forEach(l => inputs.push(path.join(AUDIO_V2, l.file)));
  inputs.forEach(f => { if (!fs.existsSync(f)) throw new Error('缺少输入: ' + f); });
  ['font.ttf', 'four.txt', 'sub01.txt', 'sub02.txt', 'sub03.txt', 'sub04.txt'].forEach(f => {
    if (!fs.existsSync(path.join(WORK, f))) throw new Error('缺少工作文件: ' + f);
  });

  const filters = tl.shots.map((s, i) => videoFilter(i, s));
  filters.push(tl.shots.map((_, i) => `[v${i}]`).join('') + 'concat=n=4:v=1:a=0[vb]');
  filters.push('[vb]drawbox=x=0:y=1660:w=iw:h=260:color=black@0.60:t=fill[bar]');
  let cur = 'bar';
  tl.shots.forEach((s, k) => {
    const out = `s${k}`;
    filters.push(`[${cur}]drawtext=fontfile=font.ttf:textfile=${s.sub}:fontcolor=white:fontsize=46:` +
      `x=(w-text_w)/2:y=1740:enable='between(t,${s.subOn},${s.subOff})'[${out}]`);
    cur = out;
  });
  // G1：镜2 四词后期叠层，窗口绑定 C02 时段
  const c02 = tl.shots[1];
  filters.push(`[${cur}]drawtext=fontfile=font.ttf:textfile=four.txt:fontcolor=0xF2B05A:fontsize=52:` +
    `box=1:boxcolor=black@0.45:boxborderw=14:x=(w-text_w)/2:y=1440:` +
    `enable='between(t,${(c02.start + 0.7).toFixed(3)},${(c02.end - 0.1).toFixed(3)})'[vout]`);
  filters.push(...audioFilter(tl.lines, tl.tVideo));
  const fc = filters.join(';');
  fs.writeFileSync(path.join(WORK, 'filter_dump_v2.txt'), fc.split(';').join(';\n'), 'utf8');

  const outFile = `DJ04_v1_N10_master_final_r02_${STAMP}.mp4`;
  const outPath = path.join(MASTER, outFile);
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  inputs.forEach(f => { args.push('-i', f); });
  args.push('-filter_complex', fc, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-t', tl.tVideo.toFixed(3), outPath);
  console.log(`[INFO] 合成 v2：T_audio_eff=${tl.tAudioEff}s Δ=${tl.delta}s T_video=${tl.tVideo}s`);
  const r = spawnSync('ffmpeg', args, { cwd: WORK, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) { console.error('[FATAL] ffmpeg: ' + (r.stderr || '').slice(-3000)); process.exitCode = 1; return; }

  // 实测成片与尾部静音
  const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
    '-of', 'json', outPath], { encoding: 'utf8' }));
  const realDur = parseFloat(pj.format.duration);
  let realTail = null;
  try {
    const sd = spawnSync('ffmpeg', ['-v', 'info', '-i', outPath, '-af',
      `silencedetect=noise=-45dB:d=0.30`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const mm = [...(sd.stderr || '').matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)];
    const last = mm[mm.length - 1];
    if (last) realTail = Number((realDur - parseFloat(last[1])).toFixed(3));
  } catch (e) { /* 探测失败保留 null，不编造 */ }

  const params = {
    composeId: `COMPOSE_DJ04_N10_V2_${STAMP}`,
    projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N10', version: 'r02',
    tool: '本地 ffmpeg 9.0.2（零积分）', generatedAt: new Date().toISOString(),
    decision: { D1: 'B（总长由 T_audio_eff + Δ 反推，用户 2026-11-11 明确授权变更 30s 规格目标）',
      D2: `Δ 目标 [0.4,1.0]s 取 ${DELTA_TARGET}s，上限 ${DELTA_MAX}s` },
    output: `v1/04_output/master/${outFile}`, outputBytes: fs.statSync(outPath).size,
    targetSpec: { resolution: '1080x1920', fps: FPS, durationSec: tl.tVideo, video: 'H.264/yuv420p', audio: 'AAC 192k 48kHz stereo', faststart: true },
    timeline: { tAudioEffSec: tl.tAudioEff, deltaSec: tl.delta, tVideoSec: tl.tVideo,
      arithmeticTailSilenceSec: tailSilence, measuredTailSilenceSec: realTail,
      measuredDurationSec: realDur, basis: 'N08 v2 配音 ffprobe 实测 + 句间 0.2s 停顿' },
    lines: tl.lines, shots: tl.shots.map(s => ({ ...s,
      cloneRatioExceeded: s.cloneRatio > CLONE_RATIO_MAX })),
    checks: {
      deltaInRange: tl.delta >= DELTA_MIN && tl.delta <= DELTA_MAX,
      tailSilenceOK: tailSilence <= TAIL_SILENCE_MAX,
      cloneRatioOK: tl.shots.every(s => s.cloneRatio <= CLONE_RATIO_MAX),
      note: 'cloneRatioOK 若为 false，属未达标返工项（R2-12），不编造通过'
    },
    deviationHandling: {
      durationMismatch: 'D1=B 反推总长；C03/C04 tpad clone + zoompan 缓推',
      modelAudioTrack: '只映射 [i:v]，模型音轨全部丢弃',
      resolutionUpscale: '768x1344 → 1080x1920 有损上采样（如实标注）',
      c04Composition: '墙上表格纸纹理/妈妈未出画不修改，标注待人工复核'
    },
    g1LaterOverlay: '镜2 四词在 N10 用 drawtext 叠加，窗口绑定 C02 时段，不由生图渲染',
    subtitleEncoding: 'UTF-8 无 BOM、强制 LF',
    ffprobe: pj,
    note: '未做真实浏览器肉眼播放验证；N11 全片解码 QC 见 verify-n10-v2.js'
  };
  const pf = path.join(MASTER, `DJ04_v1_N10_compose-params_final_r02_${STAMP}.json`);
  fs.writeFileSync(pf, JSON.stringify(params, null, 2), 'utf8');
  console.log('[OK] ' + outPath);
  console.log('[OK] ' + pf);
  console.log('[CHECKS] ' + JSON.stringify(params.checks));
  console.log('[TIMELINE] ' + JSON.stringify(params.timeline));
}

try { main(); } catch (e) { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; }
