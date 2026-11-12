/**
 * DJ04 · N10 成片合成（本地 ffmpeg，零积分）
 *
 * 输入：
 *  - 4 段 N09 r02 片段（已按 G2 擦除「AI生成」水印；模型自带音轨在此丢弃）
 *  - 9 句 N08 正式配音（音色：妈妈 M1 晓晓 -3% / 小宇 X2 云希 +0%）
 *  - 5 个 UTF-8 LF 字幕文本（4 条硬字幕 + 镜2 四词，G1 要求的后期叠层）
 *
 * 时间轴以配音真实时长为准（合计 28.296s），成片 30s，尾部 1.704s 留给结尾字幕。
 * 四项交接偏差在本脚本逐条处置，处置结果写入 compose 参数 JSON 供验收。
 *
 * 依赖：ffmpeg / ffprobe 9.0.2（本机 WinGet 安装）；msyh/simhei 字体已复制到 ASCII 工作目录
 * 运行：node scripts/compose_n10_DJ04.js
 * 输出：projects/P_20261110_004_DJ04/v1/04_output/master/DJ04_v1_N10_master_final_r01_<stamp>.mp4
 *
 * 坑位（蓝本实测，勿改）：ffmpeg 9.0.2 不支持 -filter_complex_script，filter 必须作为单参数传入；
 * 字幕必须 UTF-8 + LF（CR 会被 drawtext 渲染成「口」方块）；合成在纯 ASCII 工作目录执行。
 * 性能提示：zoompan 在 1080x1920 上逐帧处理，耗时约 1-3 分钟；如需加速可去掉 zoompan 用静态帧。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const CLIP = path.join(PROJ, 'v1/04_output/clip');
const AUDIO = path.join(PROJ, 'v1/04_output/audio');
const MASTER = path.join(PROJ, 'v1/04_output/master');
const WORK = 'D:/WorkBuddy_space/2026-11-09-10-57-28/_n10_work'; // 纯 ASCII，规避中文路径坑
const STAMP = '20261111003500';
const CLIP_STAMP = '20261111000600';

const FPS = 30;
const DURATION = 30;
const CLIP_SRC_SEC = 5.166667; // ffprobe 实测，勿用估算

/** 镜头时段：按配音累计起点切分，合计 30s */
const SEGMENTS = [
  { id: 'C01', start: 0.000, dur: 4.872, sub: 'sub01.txt', subOn: 0.30, subOff: 4.70 },
  { id: 'C02', start: 4.872, dur: 4.464, sub: 'sub02.txt', subOn: 5.10, subOff: 9.20 },
  { id: 'C03', start: 9.336, dur: 13.512, sub: 'sub03.txt', subOn: 9.60, subOff: 22.70 },
  { id: 'C04', start: 22.848, dur: 7.152, sub: 'sub04.txt', subOn: 23.00, subOff: 29.90 }
];

/** 9 句配音的真实起点（秒），来自 N08 voice-manifest 的 ffprobe 实测值 */
const LINES = [
  { id: 'L01', start: 0.000 }, { id: 'L02', start: 3.000 },
  { id: 'L03', start: 4.872 }, { id: 'L04', start: 7.080 },
  { id: 'L05', start: 9.336 }, { id: 'L06', start: 16.608 },
  { id: 'L07', start: 20.280 }, { id: 'L08', start: 22.848 },
  { id: 'L09', start: 26.352 }
];

/** 校验时间轴自洽，避免拼接出错误时长 */
function assertTimeline() {
  const sum = SEGMENTS.reduce((s, x) => s + x.dur, 0);
  if (Math.abs(sum - DURATION) > 0.001) throw new Error(`镜头时段合计 ${sum}s != ${DURATION}s`);
  if (SEGMENTS[SEGMENTS.length - 1].start + SEGMENTS[SEGMENTS.length - 1].dur !== 30) {
    throw new Error('末镜结束时间不等于 30s');
  }
  if (LINES.length !== 9) throw new Error('配音句数不是 9');
}

/**
 * 构造单镜头视频滤镜链。
 * 偏差处置：① -an 语义通过只取 [i:v] 实现（丢弃模型音轨）；
 * ② 768x1344 → 1080x1920 上采样（scale cover + crop + fps=30）；
 * ③ tpad=stop_mode=clone 补帧到镜头目标时长；④ zoompan 缓慢推近避免补帧段完全静止。
 * @param {number} i 输入序号（0 起）
 * @param {object} seg 镜头时段定义
 * @returns {string} 该镜头的 filter 片段
 */
function videoFilter(i, seg) {
  const pad = Math.max(0, seg.dur - CLIP_SRC_SEC);
  const chain = [
    'scale=1080:1920:force_original_aspect_ratio=increase', // 768x1344 → 1097x1920
    'crop=1080:1920', 'setsar=1',
    `fps=${FPS}`
  ];
  if (pad > 0.001) chain.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`);
  chain.push(`trim=duration=${seg.dur.toFixed(3)}`, 'setpts=PTS-STARTPTS');
  // 缓慢推近；d=1 表示每个输入帧输出 1 帧，on 递增使克隆帧仍保持轻微运动
  chain.push("zoompan=z='min(zoom+0.0004,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30");
  // 输入标签必须紧贴首个 filter，不能用逗号分隔（否则 ffmpeg 报 "No such filter: ''"）
  return `[${i}:v]` + chain.join(',') + `[v${i}]`;
}

/** 构造 9 路配音的延时与混音链 */
function audioFilter(startIdx) {
  const parts = LINES.map((l, k) =>
    `[${startIdx + k}:a]adelay=${Math.round(l.start * 1000)}:all=1[a${k}]`
  );
  const labels = LINES.map((_, k) => `[a${k}]`).join('');
  parts.push(`${labels}amix=inputs=9:duration=longest:normalize=0,apad,atrim=duration=${DURATION}[aout]`);
  return parts;
}

/** 构造硬字幕与镜2 四词叠层（G1：文案一律后期叠，不由生图渲染） */
function subtitleFilter() {
  const parts = [];
  parts.push('[vb]drawbox=x=0:y=1660:w=iw:h=260:color=black@0.60:t=fill[bar]');
  let cur = 'bar';
  SEGMENTS.forEach((s, k) => {
    const out = `s${k}`;
    parts.push(`[${cur}]drawtext=fontfile=font.ttf:textfile=${s.sub}:fontcolor=white:fontsize=46:` +
      `x=(w-text_w)/2:y=1740:enable='between(t,${s.subOn},${s.subOff})'[${out}]`);
    cur = out;
  });
  // 镜2 四词：叠加在镜2 时段（4.872–9.336），置于字幕条上方，琥珀色模拟红笔标注
  parts.push(`[${cur}]drawtext=fontfile=font.ttf:textfile=four.txt:fontcolor=0xF2B05A:fontsize=52:` +
    `box=1:boxcolor=black@0.45:boxborderw=14:x=(w-text_w)/2:y=1440:` +
    `enable='between(t,5.60,9.20)'[vout]`);
  return parts;
}

/** 主流程：校验 → 组装 filter_complex → 调 ffmpeg → ffprobe 自检 → 写参数 JSON */
function main() {
  assertTimeline();
  fs.mkdirSync(MASTER, { recursive: true });

  const inputs = [];
  SEGMENTS.forEach((_, i) => inputs.push(path.join(CLIP,
    `DJ04_v1_N09_clip-${String(i + 1).padStart(2, '0')}_final_r02_${CLIP_STAMP}.mp4`)));
  LINES.forEach(l => inputs.push(path.join(AUDIO,
    `DJ04_v1_N08_voice-${l.id}_final_r01_${CLIP_STAMP}.mp3`)));
  inputs.forEach(f => { if (!fs.existsSync(f)) throw new Error('缺少输入文件: ' + f); });
  ['font.ttf', 'sub01.txt', 'sub02.txt', 'sub03.txt', 'sub04.txt', 'four.txt'].forEach(f => {
    if (!fs.existsSync(path.join(WORK, f))) throw new Error('缺少工作文件: ' + f);
  });

  const filters = [];
  SEGMENTS.forEach((s, i) => filters.push(videoFilter(i, s)));
  filters.push(SEGMENTS.map((_, i) => `[v${i}]`).join('') + 'concat=n=4:v=1:a=0[vb]');
  filters.push(...subtitleFilter());
  filters.push(...audioFilter(SEGMENTS.length));
  const fc = filters.join(';');
  // 落盘 filtergraph 便于排错与复现（蓝本：ffmpeg 9.0.2 不支持 -filter_complex_script）
  fs.writeFileSync(path.join(WORK, 'filter_dump.txt'), fc.split(';').join(';\n'), 'utf8');
  if (process.env.N10_DUMP_ONLY === '1') { console.log('[DUMP] ' + path.join(WORK, 'filter_dump.txt')); return; }

  const outFile = `DJ04_v1_N10_master_final_r01_${STAMP}.mp4`;
  const outPath = path.join(MASTER, outFile);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  inputs.forEach(f => { args.push('-i', f); });
  args.push(
    '-filter_complex', fc,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-t', String(DURATION), outPath
  );

  console.log('[INFO] 开始合成，输入 4 视频 + 9 音频，目标 1080x1920 / 30fps / 30s');
  const r = spawnSync('ffmpeg', args, { cwd: WORK, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error('[FATAL] ffmpeg exit=' + r.status + '\n' + (r.stderr || '').slice(-4000));
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 100000) {
    console.error('[FATAL] 成片缺失或过小');
    process.exitCode = 1;
    return;
  }

  // ffprobe 自检：时长 / 编码 / 分辨率 / 音轨 / faststart
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
    '-of', 'json', outPath], { encoding: 'utf8' });
  const pj = JSON.parse(probe.stdout || '{}');

  const params = {
    composeId: `COMPOSE_DJ04_N10_${STAMP}`,
    projectId: 'P_20261110_004', projectCode: 'DJ04', nodeId: 'N10',
    tool: '本地 ffmpeg 9.0.2（零积分）', generatedAt: new Date().toISOString(),
    output: `v1/04_output/master/${outFile}`,
    outputBytes: fs.statSync(outPath).size,
    targetSpec: { resolution: '1080x1920', fps: FPS, durationSec: DURATION, video: 'H.264/yuv420p', audio: 'AAC 192k 48kHz stereo', faststart: true },
    timelineBasis: 'N08 配音真实时长（manifest ffprobe 实测 28.296s），非清单估算 21.8s',
    segments: SEGMENTS.map((s, i) => ({
      id: s.id, start: s.start, durationSec: s.dur,
      source: `DJ04_v1_N09_clip-${String(i + 1).padStart(2, '0')}_final_r02_${CLIP_STAMP}.mp4`,
      upscale: '768x1344 → 1080x1920 (scale cover + crop + fps 30)',
      padSec: Number(Math.max(0, s.dur - CLIP_SRC_SEC).toFixed(3)),
      subtitle: s.sub, subtitleWindow: [s.subOn, s.subOff]
    })),
    audioLines: LINES.map(l => ({ id: l.id, startSec: l.start, adelayMs: Math.round(l.start * 1000) })),
    g1LaterOverlay: '镜2 四词「知识 审题 计算 时间」在 N10 以 drawtext 叠加（5.60–9.20s），未由生图渲染',
    deviationHandling: {
      durationMismatch: '镜头时段按配音累计起点切分；C03/C04 用 tpad=stop_mode=clone 补帧到 13.512s / 7.152s；尾部 1.704s 留白给结尾字幕',
      modelAudioTrack: '只映射 [i:v]，4 段模型音轨全部丢弃；成片音轨由 9 句 N08 配音 amix 生成',
      resolutionUpscale: '768x1344 上采样并轻微裁切到规格包 1080x1920；属有损放大，已在验收记录',
      c04Composition: '墙上表格纸模糊纹理 / 妈妈未出画属模型再演绎，本轮未修改画面，标注为待人工复核项'
    },
    subtitleEncoding: 'UTF-8 无 BOM、强制 LF（规避 drawtext 把 CR 渲染成「口」方块）',
    ffprobe: pj,
    note: '本成片未做真实浏览器肉眼播放验证；N11 全片解码 QC 待执行。'
  };
  const paramFile = path.join(MASTER, `DJ04_v1_N10_compose-params_final_r01_${STAMP}.json`);
  fs.writeFileSync(paramFile, JSON.stringify(params, null, 2), 'utf8');
  console.log('[OK] 成片: ' + outPath);
  console.log('[OK] 参数: ' + paramFile);
  console.log('[PROBE] ' + JSON.stringify(pj));
}

try { main(); } catch (e) {
  console.error('[FATAL]', e && e.stack ? e.stack : e);
  process.exitCode = 1;
}
