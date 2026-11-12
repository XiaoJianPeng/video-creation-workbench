/**
 * DJ04 · N08 配音音色试听样本生成（本地免费 TTS）
 *
 * 用途：为「妈妈 / 小宇」两个角色各生成 3 个音色候选，供用户试听后选音色。
 * 本脚本只产出「试听样本」，不产出正式配音；正式配音待试听结论确定后再生成。
 * 台词取自 N08 配音清单 DJ04_v1_N08_voice-01_final_r01_20261110205600.json（L01/L05、L02/L06）。
 *
 * 依赖：msedge-tts（复用蓝本已安装模块，无需联网安装；合成时需连接微软 Edge TTS 服务）
 * 运行：node scripts/tts_trial_DJ04.js
 * 输出：projects/P_20261110_004_DJ04/v1/03_asset/audio/trial/
 *
 * 注意：单个音色失败不中断整批，失败项写入清单 failed 字段，便于降级。
 */
const fs = require('node:fs');
const path = require('node:path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require(
  'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/短剧实测/_build/tts/node_modules/msedge-tts'
);

const OUT_DIR = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间/projects/P_20261110_004_DJ04/v1/03_asset/audio/trial';
const STAMP = '20261110234000';
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;

// 固定试听句：同角色所有候选读同一段，保证音色可比
const MOM_TEXT = '明天就考了，复习得怎么样？先别看分。咱把这三类分开——基础丢的、粗心丢的、没时间写的。';
const BOY_TEXT = '……还行吧。原来不是不会，是会了没时间写。';

/** 试听候选表：id / 角色 / 音色 / 展示名 / 语速 / 建议 pitch（仅记录，不施加） */
const CANDIDATES = [
  { id: 'M1', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 Xiaoxiao（温和中年，推荐）', rate: '-3%', pitch: '-2%', text: MOM_TEXT },
  { id: 'M2', role: '妈妈', voice: 'zh-CN-XiaoyiNeural', label: '晓伊 Xiaoyi（更年轻柔和）', rate: '-3%', pitch: '-2%', text: MOM_TEXT },
  { id: 'M3', role: '妈妈', voice: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 原速对照', rate: '+0%', pitch: '+0%', text: MOM_TEXT },
  { id: 'X1', role: '小宇', voice: 'zh-CN-YunxiaNeural', label: '云夏 Yunxia（少年男声，推荐）', rate: '+0%', pitch: '+0%', text: BOY_TEXT },
  { id: 'X2', role: '小宇', voice: 'zh-CN-YunxiNeural', label: '云希 Yunxi（青年男声·口语）', rate: '+0%', pitch: '+0%', text: BOY_TEXT },
  { id: 'X3', role: '小宇', voice: 'zh-CN-YunjianNeural', label: '云健 Yunjian（低沉·疲惫感）', rate: '-3%', pitch: '+0%', text: BOY_TEXT }
];

/**
 * 合成单个候选的试听音频并落盘
 * @param {object} c 候选配置
 * @returns {Promise<object>} 含文件名、字节数、状态的结果项
 */
async function synthOne(c) {
  const file = `DJ04_v1_N08_trial-${c.id}_final_r01_${STAMP}.mp3`;
  const dest = path.join(OUT_DIR, file);
  // 每个音色独立实例：setMetadata 绑定音色，复用实例会串音色
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 60000 });
  await tts.setMetadata(c.voice, FORMAT);
  const { audioStream } = await tts.toStream(c.text, { rate: c.rate });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    audioStream.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    audioStream.pipe(ws);
  });
  return { ...c, file, absPath: dest, bytes: fs.statSync(dest).size, status: 'ok' };
}

/** 生成人类可读的试听对照表 Markdown */
function buildMarkdown(items, stampTime) {
  const rows = items.map((i) =>
    `| ${i.id} | ${i.role} | ${i.label} | \`${i.voice}\` | ${i.rate} | ${i.status === 'ok' ? i.bytes + ' B' : '生成失败'} | \`${i.file}\` |`
  ).join('\n');
  return `# N08 配音音色试听对照表｜DJ04\n\n` +
    `> 生成时间：${stampTime}；工具：本地 msedge-tts（免费，未消耗 WorkBuddy 积分）。\n` +
    `> 本目录仅含**试听样本**，正式配音待你给出音色结论后生成。\n` +
    `> 同角色各候选读同一段台词，便于直接 A/B 对比。\n\n` +
    `| 编号 | 角色 | 音色 | voice ID | 语速 | 大小 | 文件 |\n|---|---|---|---|---|---|---|\n${rows}\n\n` +
    `## 试听建议\n\n` +
    `1. 先听 M1 / M2 / M3 选妈妈音色；再听 X1 / X2 / X3 选小宇音色。\n` +
    `2. M3 是 M1 的原速对照，用来判断 -3% 是否偏慢。\n` +
    `3. 角色设定：小宇 15 岁初三男生、略低带疲惫感；妈妈 40 岁左右、温和语速偏慢不夸张。\n` +
    `4. 结论格式建议：\`妈妈=M1，小宇=X2\`（或指出需微调的语速/音高）。\n\n` +
    `## 试听文本\n\n- 妈妈：${MOM_TEXT}\n- 小宇：${BOY_TEXT}\n`;
}

/** 主流程：建目录 → 逐候选合成（失败不中断）→ 写 JSON 清单与 MD 对照表 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const items = [];
  for (const c of CANDIDATES) {
    try {
      const r = await synthOne(c);
      items.push(r);
      console.log(`[OK] ${c.id} ${c.voice} ${r.bytes} bytes -> ${r.file}`);
    } catch (err) {
      // 单音色失败不阻断整批，留痕便于降级
      const msg = err && err.message ? err.message : String(err);
      items.push({ ...c, file: `DJ04_v1_N08_trial-${c.id}_final_r01_${STAMP}.mp3`, status: 'failed', error: msg });
      console.log(`[FAIL] ${c.id} ${c.voice}: ${msg}`);
    }
  }
  const stampTime = new Date().toISOString();
  const manifest = {
    manifestId: `TRIAL_DJ04_N08_${STAMP}`,
    projectId: 'P_20261110_004',
    projectCode: 'DJ04',
    nodeId: 'N08',
    purpose: '音色试听样本（非最终配音）',
    tool: 'msedge-tts（本地免费 TTS）',
    billing: '零积分',
    basedOn: 'DJ04_v1_N08_voice-01_final_r01_20261110205600.json',
    generatedAt: stampTime,
    items
  };
  fs.writeFileSync(path.join(OUT_DIR, `DJ04_v1_N08_trial-manifest_final_r01_${STAMP}.json`), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, `DJ04_v1_N08_试听对照表_final_r01_${STAMP}.md`), buildMarkdown(items, stampTime), 'utf8');
  const ok = items.filter((i) => i.status === 'ok').length;
  console.log(`DONE ok=${ok}/${items.length}`);
  if (ok === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[FATAL]', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
