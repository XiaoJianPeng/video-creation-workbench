/**
 * 项目强约束 G1/G2 + N08 试听样本验收脚本（零依赖）
 *
 * 验证范围：
 *  1. app.js 五处强约束挂载点（常量 / 判据 / 提示词模板 / 设置页 / 导出）
 *  2. 规范层与项目数据层落盘（v1.1 §24、走查说明 §17、project.meta.json、r02 提示词）
 *  3. r02 四张擦除产物真实存在、尺寸统一、r01 原图零覆盖
 *  4. N08 六个试听样本真实存在且可被 ffprobe 解码
 *  5. 本地服务 health 可用
 *
 * 数据安全：全程只读；蓝本 短剧实测/ 只读复用 TTS 模块，零改动；线上零接入零写入。
 * 运行：node verify-hardrules.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const APP = path.join(W, 'prototype/pc-v1/app.js');
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const IMG = path.join(PROJ, 'v1/03_asset/image');
const AUD = path.join(PROJ, 'v1/03_asset/audio/trial');
const BASE = 'http://127.0.0.1:8791';

let pass = 0, fail = 0;
/** 单条断言 */
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
/** 读取 PNG 宽高，不依赖第三方库 */
function pngSize(f) {
  const b = fs.readFileSync(f).subarray(0, 24);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const app = fs.readFileSync(APP, 'utf8');
const doc11 = fs.readFileSync(path.join(W, '通用视频创作项目管理工作台_需求设计文档_v1.1.md'), 'utf8');
const walk = fs.readFileSync(path.join(W, 'PC工作台原型_走查问题分析与操作说明_v1.0.md'), 'utf8');
const meta = JSON.parse(fs.readFileSync(path.join(PROJ, 'project.meta.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(PROJ, 'assets.index.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(AUD, 'DJ04_v1_N08_trial-manifest_final_r01_20261110234000.json'), 'utf8'));
const promptR2 = fs.readFileSync(path.join(PROJ, 'v1/02_prompt/image/DJ04_v1_N06_prompt-01_final_r02_20261110234500.md'), 'utf8');
const promptR1 = fs.readFileSync(path.join(PROJ, 'v1/02_prompt/image/DJ04_v1_N06_prompt-01_final_r01_20261110205600.md'), 'utf8');

console.log('=== 1. app.js 强约束挂载点 ===');
ck('常量 PROJECT_HARD_RULES 存在', app.includes('var PROJECT_HARD_RULES = ['));
ck('作用域 IMAGE_NODE_IDS 覆盖 N06/N09', /var IMAGE_NODE_IDS = \{[^}]*N06[^}]*N09/.test(app));
ck('G1 名称与规则入库', app.includes("id: 'G1', name: '生图不带文字'") && app.includes('禁止出现任何文字'));
ck('G2 名称与规则入库', app.includes("id: 'G2', name: '水印擦除后交付'") && app.includes('图像擦除工具去除'));
ck('N06 判据已替换为 G1/G2', app.includes("'画面无任何文字（G1 强约束）'") && app.includes("'工具水印已擦除（G2 强约束）'"));
ck('N06 旧判据「中文渲染正常」已移除', !/N06[\s\S]{0,400}?criteria:[\s\S]{0,160}?中文渲染正常/.test(app));
ck('N09 判据含 G1/G2', app.includes("'输入图无文字无水印（G1/G2）'"));
ck('N11 后期字幕判据保留且注明不冲突', app.includes('N11 的「中文渲染正常」检查对象是 N10 后期字幕层'));
ck('promptFor 注入 G1/G2 两行', app.includes('【项目强约束 G1 · 生图不带文字】') && app.includes('【项目强约束 G2 · 水印擦除后交付】'));
ck('提示词模板写明文案走 N10 叠层', app.includes('所需文案一律走 N10 后期字幕/标题叠层'));
ck('hardRulesHtml 函数存在且被 N06/N09 执行区调用', app.includes('function hardRulesHtml()') && app.includes('(IMAGE_NODE_IDS[id] ? hardRulesHtml() : \'\')'));
ck('设置页「项目强约束」卡片存在且无开关', app.includes('项目强约束（全局生效 · 不可关闭）') && app.includes('不提供开关'));
ck('任务包导出携带 hardRules + hardRuleScope', app.includes('hardRules: PROJECT_HARD_RULES') && app.includes('hardRuleScope: Object.keys(IMAGE_NODE_IDS)'));
ck('app.js 语法可编译', (function () { try { new Function(app); return true; } catch (e) { return false; } })());

console.log('=== 2. 规范层与项目数据层 ===');
ck('需求文档 v1.1 新增 §24', doc11.includes('## 24. 项目强约束'));
ck('新增 AC-51 / AC-52', doc11.includes('AC-51') && doc11.includes('AC-52'));
ck('§24 写明触发事实（乱码 + 水印）', doc11.includes('AI 渲染中文四词乱码') && doc11.includes('AI生成 WORKBUDDY'));
ck('§24 标注服务端零改动边界', doc11.includes('零改动'));
ck('走查说明新增 §17', walk.includes('## 17. 项目强约束'));
ck('§17 含 N08 音频位置与操作路径', walk.includes('v1/03_asset/audio/trial/') && walk.includes('项目设置'));
ck('project.meta.json 含 2 条 hardRules', Array.isArray(meta.hardRules) && meta.hardRules.length === 2);
ck('meta 标记当前提示词版本 r02', meta.promptVersion === 'r02');
ck('r02 提示词含 G1 禁止文字约束', promptR2.includes('画面中不含任何文字') && promptR2.includes('⛔ 项目强约束'));
ck('r02 已移除中文四词生图要求', promptR2.includes('删除该要求') && !promptR2.includes('竖排写四个中文词'));
ck('r02 明确产物 rev 递增不覆盖', promptR2.includes('不覆盖 r01 原图'));
ck('r01 提示词原文保留（零覆盖）', promptR1.includes('竖排写四个中文词'));
// 资产库会随 N08/N09/N10/N11/N12 继续增长，断言按 N06 + rev 过滤而非总数（R2 整批后修正）
const n06 = assets.assets.filter(a => a.node === 'N06');
ck('assets.index.json 中 N06 登记 8 条（r01 4 + r02 4）', n06.length === 8, String(n06.length));
ck('N06 r02 四条均标注 hardRules G1/G2',
  n06.filter(a => a.rev === 'r02' && Array.isArray(a.hardRules) && a.hardRules.join(',') === 'G1,G2').length === 4);

console.log('=== 3. 擦除产物 ===');
for (let i = 1; i <= 4; i++) {
  const r2 = path.join(IMG, `DJ04_v1_N06_image-${String(i).padStart(2, '0')}_final_r02_20261110234500.png`);
  const r1 = path.join(IMG, `DJ04_v1_N06_image-${String(i).padStart(2, '0')}_final_r01_20261110231013.png`);
  ck(`镜${i} r02 存在且非空`, fs.existsSync(r2) && fs.statSync(r2).size > 100000);
  if (fs.existsSync(r2)) {
    const s = pngSize(r2);
    ck(`镜${i} r02 尺寸 1072x1920`, s.w === 1072 && s.h === 1920, `${s.w}x${s.h}`);
  }
  ck(`镜${i} r01 原图保留（零覆盖）`, fs.existsSync(r1) && fs.statSync(r1).size > 100000);
}
ck('镜2 原始擦除结果留档 06_build/', fs.existsSync(path.join(PROJ, 'v1/06_build/DJ04_v1_N06_image-02_erase-raw_r02_20261110234500.png')));

console.log('=== 4. N08 试听样本 ===');
ck('清单 6 项且全部 ok', manifest.items.length === 6 && manifest.items.every(x => x.status === 'ok'));
ck('清单标注零积分', manifest.billing.includes('零积分'));
for (const it of manifest.items) {
  const f = path.join(AUD, it.file);
  ck(`${it.id} mp3 存在且字节数吻合`, fs.existsSync(f) && fs.statSync(f).size === it.bytes);
}
ck('试听对照表 md 存在', fs.existsSync(path.join(AUD, 'DJ04_v1_N08_试听对照表_final_r01_20261110234000.md')));
let allDecodable = true;
for (const it of manifest.items) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(AUD, it.file)], { encoding: 'utf8' }).trim();
    if (!(parseFloat(out) > 1)) allDecodable = false;
  } catch (e) { allDecodable = false; }
}
ck('6 个样本均可被 ffprobe 解码且时长 > 1s', allDecodable);

console.log('=== 5. 本地服务 ===');
(async function () {
  try {
    const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
    ck('/api/health 返回 200', r.status === 200);
  } catch (e) {
    ck('/api/health 返回 200', false, e.message);
  }
  console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
  process.exitCode = fail ? 1 : 0;
})();
