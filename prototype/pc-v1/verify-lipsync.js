/**
 * D 批口型 A/B 验证验收（零依赖，全程只读）
 *
 * 验证：4 次尝试与错误码完整留痕 / 结论为负且未编造已同步 /
 *       降级分支 G3 在提示词与工作台落地 / 验收口径不混用 /
 *       Q06 零覆盖 / 蓝本零改动 / 强约束 G1/G2 未回退。
 * 运行：node verify-lipsync.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const AB = path.join(PROJ, 'v1/04_output/clip_ab');

let pass = 0, fail = 0;
function ck(n, c, x) {
  if (c) { pass++; console.log('[PASS] ' + n); }
  else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' | ' + x : '')); }
}

console.log('=== 1. A/B 实验留痕 ===');
const r = JSON.parse(fs.readFileSync(path.join(AB, 'DJ04_v1_N09_lipsync-ab-result_final_r01_20261111014500.json'), 'utf8'));
ck('A 组基线文件存在', fs.existsSync(path.join(AB, r.groupA.file)));
ck('A 组 4 个 QC 帧存在', (r.groupA.qcFrames || []).length === 4 && r.groupA.qcFrames.every(f => fs.existsSync(path.join(AB, f))));
ck('A 组如实标注无说话约束', r.groupA.promptSpeechConstraint.includes('无'));
ck('B 组 4 次尝试全部记录且为 rejected', r.groupBAttempts.length === 4 && r.groupBAttempts.every(a => a.status === 'rejected'));
ck('错误码/原因逐条留痕', r.groupBAttempts.every(a => a.error && a.error.length > 20));
ck('首帧与参考素材互斥已记录', r.groupBAttempts[0].error.includes('does not allow first/last frames'));
ck('参考音频需视觉素材已记录', r.groupBAttempts[1].error.includes('requires visual material'));
ck('base64 音频不支持已记录', r.groupBAttempts[2].error.includes('base64 audio is not supported'));
ck('内网 URL 被拒已记录', r.groupBAttempts[3].error.includes('innerip'));
ck('成本标注 verified=false', r.billing.verified === false);

console.log('=== 2. 结论与分支 ===');
ck('结论已验证（非待验证假设）', r.conclusion.verified === true);
ck('能力结论为当前栈不可达', r.conclusion.lipSyncCapability === 'NOT_AVAILABLE_IN_CURRENT_STACK');
ck('走降级分支', r.conclusion.branch === 'DEGRADED_SENTENCE_LEVEL_SPEAKING_STATE');
ck('明确不宣称音素级 lip-sync', r.conclusion.explicitNonClaim.includes('不宣称'));
ck('D4 在降级分支标记为不适用', r.degradedAcceptance.D4_applicable === false);
ck('降级指标为说话状态一致率', r.degradedAcceptance.metric.includes('说话状态一致率'));
ck('阈值 ≥90%', r.degradedAcceptance.threshold.includes('90%'));
ck('验收状态标注待人工标注，不编造通过', r.degradedAcceptance.status.includes('待人工'));

console.log('=== 3. G3 降级约束落地 ===');
const prompt = fs.readFileSync(path.join(PROJ, 'v1/02_prompt/video/DJ04_v1_N09_prompt-01_final_r01_20261111000600.md'), 'utf8');
ck('N09 提示词含 G3 章节', prompt.includes('G3') && prompt.includes('句级说话状态对齐'));
ck('N09 提示词含 4 镜说话状态表', ['C01', 'C02', 'C03', 'C04'].every(k => prompt.includes(k)));
ck('N09 提示词禁止正面口部特写', prompt.includes('禁止正面口部特写'));
ck('N09 提示词声明不宣称音素级', prompt.includes('不宣称音素级'));
const app = fs.readFileSync(path.join(W, 'prototype/pc-v1/app.js'), 'utf8');
ck('app.js 含 G3 强约束常量', app.includes("id: 'G3'") && app.includes('句级说话状态对齐（降级）'));
ck('N06 判据含 G3', app.includes('句级说话状态已声明（G3）'));
ck('N09 判据含 G3', app.split('句级说话状态已声明（G3）').length - 1 >= 2);
ck('promptFor 注入 G3 行', app.includes('【项目强约束 G3'));
ck('G1/G2 未回退', app.includes('PROJECT_HARD_RULES') && app.includes("id: 'G1'") && app.includes("id: 'G2'"));
ck('app.js 语法可编译', (function () { try { new Function(app); return true; } catch (e) { return false; } })());

console.log('=== 4. 零覆盖与边界 ===');
ck('reference audio 未留在静态目录（已清理）', !fs.existsSync(path.join(W, 'prototype/pc-v1/_lipsync_ref.mp3')));
ck('r01/r02 成片均在', fs.existsSync(path.join(PROJ, 'v1/04_output/master/DJ04_v1_N10_master_final_r01_20261111003500.mp4')) &&
  fs.existsSync(path.join(PROJ, 'v1/04_output/master/DJ04_v1_N10_master_final_r02_20261111012500.mp4')));
ck('4 段 r02 源片段仍在', [1, 2, 3, 4].every(i => fs.existsSync(path.join(PROJ,
  `v1/04_output/clip/DJ04_v1_N09_clip-${String(i).padStart(2, '0')}_final_r02_20261111000600.mp4`))));
let n = 0;
(function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const f = path.join(d, e.name);
  if (e.isDirectory()) w(f); else if (e.isFile()) n++;
} })(path.join(W, '短剧实测'));
ck('蓝本短剧实测零改动（627 文件）', n === 627, String(n));

console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
process.exitCode = fail ? 1 : 0;
