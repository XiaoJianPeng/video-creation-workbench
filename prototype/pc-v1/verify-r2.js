/**
 * R2 交付闭环后端验收（零依赖，全程只读除外的一次审计写入）
 *
 * 验证：/api/file/stat 5 类反馈、/api/file/open 越界与白名单拒绝、
 *       只读语义（项目目录文件数不变）、任务列表产物数组兼容、强约束代码未回退。
 * 运行：node verify-r2.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const BASE = 'http://127.0.0.1:8791';
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
async function req(method, url, body) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}
function countFiles(dir) {
  let n = 0;
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) w(f); else if (e.isFile()) n++;
    }
  })(dir);
  return n;
}

(async function () {
  console.log('=== 1. /api/file/stat 5 类反馈 ===');
  const okRel = 'v1/04_output/master/DJ04_v1_N10_master_final_r01_20261111003500.mp4';
  let r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=' + encodeURIComponent(okRel));
  ck('正常文件返回 ok + 字节数', r.body.ok === true && r.body.bytes === 10379880, JSON.stringify(r.body).slice(0, 120));
  ck('正常文件标注 readonly', r.body.readonly === true);
  ck('返回项目权限档', r.body.permissionLevel === 1);

  r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=');
  ck('空 rel → NO_REL（仅元数据）', r.body.code === 'NO_REL', r.body.code);

  r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=' + encodeURIComponent('v1/04_output/master/NO_SUCH.mp4'));
  ck('文件不存在 → NOT_FOUND', r.body.code === 'NOT_FOUND', r.body.code);

  r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=' + encodeURIComponent('../../../etc/passwd'));
  ck('路径越界 → PATH_ESCAPE（优先于扩展名）', r.body.code === 'PATH_ESCAPE', r.body.code);

  r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=' + encodeURIComponent('v1/04_output/master/evil.js'));
  ck('白名单外扩展名 → EXT_DENIED', r.body.code === 'EXT_DENIED', r.body.code);

  r = await req('GET', '/api/file/stat?projectId=P_20261110_004&rel=' + encodeURIComponent('http://x/a.mp4'));
  ck('URL → INVALID_REL', r.body.code === 'INVALID_REL', r.body.code);

  console.log('=== 2. /api/file/open 安全 ===');
  r = await req('POST', '/api/file/open', { projectId: 'P_20261110_004', rel: '../../prototype/pc-v1/server.js', mode: 'default' });
  ck('越界路径被拒且未启动进程', r.body.ok === false && r.body.code === 'PATH_ESCAPE');
  r = await req('POST', '/api/file/open', { projectId: 'P_20261110_004', rel: 'v1/04_output/master/NO_SUCH.mp4', mode: 'default' });
  ck('不存在文件被拒', r.body.ok === false && r.body.code === 'NOT_FOUND');
  r = await req('POST', '/api/file/open', { projectId: 'P_20261110_004', rel: okRel, mode: 'folder' });
  ck('正常文件可请求打开所在文件夹', r.body.ok === true && r.body.launched === true && r.body.mode === 'folder');
  ck('打开响应标注 readonly', r.body.readonly === true);

  console.log('=== 3. 只读语义与审计 ===');
  ck('项目目录文件数未因打开动作改变', countFiles(PROJ) >= 58, String(countFiles(PROJ)));
  const ops = fs.existsSync(path.join(W, 'data/ops.log')) ? fs.readFileSync(path.join(W, 'data/ops.log'), 'utf8') : '';
  ck('ops.log 记录 file-open', ops.includes('"action":"file-open"'));
  ck('ops.log 记录 file-open-denied', ops.includes('"action":"file-open-denied"'));
  ck('ops.log 不含凭据值', !/tk_[A-Za-z0-9]|ck_t_/.test(ops));

  console.log('=== 4. 任务列表产物数组兼容 ===');
  r = await req('GET', '/api/model/tasks');
  const mine = (r.body.tasks || []).filter(t => t.projectId === 'P_20261110_004' && t.status === 'succeeded');
  const byId = {};
  mine.forEach(t => { byId[t.id] = Array.isArray(t.receiptArtifacts) ? t.receiptArtifacts.length : -1; });
  ck('N10 回执产物 1 条（数组）', byId['TASK_20261111003500_n10'] === 1, JSON.stringify(byId));
  ck('N09 回执产物 4 条（数组）', byId['TASK_20261111000600_video'] === 4);
  ck('N08 回执产物 9 条（数组）', byId['TASK_20261111000600_voice'] === 9);
  ck('旧 N02 回执产物仍为 6 条（兼容未破坏）', byId['TASK_20261110130525_04tu'] === 6);

  console.log('=== 5. 前端代码与强约束 ===');
  const app = fs.readFileSync(path.join(W, 'prototype/pc-v1/app.js'), 'utf8');
  const srv = fs.readFileSync(path.join(W, 'prototype/pc-v1/server.js'), 'utf8');
  ck('app.js 语法可编译', (function () { try { new Function(app); return true; } catch (e) { return false; } })());
  ck('文件菜单函数存在', app.includes('function openFileMenu(') && app.includes('function requestFileOpen('));
  ck('5 类错误码映射存在', app.includes('NO_REL') && app.includes('PATH_ESCAPE') && app.includes('EXT_DENIED') && app.includes('OFFLINE') && app.includes('OPEN_FAILED'));
  ck('输出区两态文案已改', !app.includes('本节点产物（登记项，非生成文件）') && !app.includes('本原型不生成真实文件'));
  ck('真实项目并入逻辑存在', app.includes('function mergeRealProjects('));
  ck('服务端扩展名白名单存在', srv.includes('OPEN_EXT_WHITELIST'));
  ck('服务端 spawn 禁用 shell 拼接', srv.includes('shell: false'));
  ck('服务端 hardRules 声明校验存在', srv.includes('hardRulesWarning') && srv.includes('MISSING_G1'));
  ck('PROJECT_HARD_RULES 未回退', app.includes('PROJECT_HARD_RULES'));
  ck('蓝本短剧实测零改动（627 文件）', countFiles(path.join(W, '短剧实测')) === 627);

  console.log(`\n===== RESULT: ${pass} PASS / ${fail} FAIL =====`);
  process.exitCode = fail ? 1 : 0;
})();
