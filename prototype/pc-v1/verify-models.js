/**
 * 模型与协作层验收脚本（零依赖）
 *
 * 验证：凭据只读状态（绝不回显值）/ WorkBuddy 桥接任务包 / 权限档 /
 *       任务包列表与文件存在标记 / 审计留痕 / 蓝本零改动。
 *
 * 数据安全：
 *   - 不读取、不打印、不落地任何凭据值
 *   - 测试任务包文件在验证结束立即删除；tasks.index.jsonl 保留索引记录作为审计（不覆盖既有文件）
 *   - 蓝本 短剧实测/ 只读；线上业务数据零接入零写入
 *   - 本脚本不调用任何模型、不消耗积分
 *
 * 运行：node verify-models.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:8791';
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const BLUEPRINT = path.join(W, '短剧实测');
const TASKS_DIR = path.join(W, 'data', 'tasks');

let pass = 0, fail = 0, createdFiles = [];
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' | ' + extra : '')); }
}
async function req(method, url, body) {
  const r = await fetch(BASE + url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let j = {};
  try { j = await r.json(); } catch (e) { /* 忽略非 JSON 响应 */ }
  return { status: r.status, body: j };
}
function countFiles(dir) {
  let n = 0;
  (function w(d) {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    es.forEach(function (e) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) w(f); else if (e.isFile()) n++;
    });
  })(dir);
  return n;
}
function taskBody(over) {
  return Object.assign({
    projectId: 'P_VERIFY_MODEL', nodeId: 'N06', slot: 'image',
    channel: 'WorkBuddy 桥接（默认）', model: 'WorkBuddy 生图（桥接）',
    billable: true, prompt: '# 验收用提示词', params: { resolution: '1080P' }
  }, over || {});
}

(async function () {
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) { /* 未就绪 */ }
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  if (!ready) { console.log('[FATAL] 本地服务未就绪'); process.exit(1); }

  const blueprintBefore = countFiles(BLUEPRINT);
  console.log('基线：蓝本 ' + blueprintBefore + ' 文件\n');

  /* 1. 凭据只读状态 */
  const cr = await req('GET', '/api/model/credentials');
  ck('credentials 200', cr.status === 200, cr.status);
  ck('credentials 只读零写入', cr.body.readonly === true && cr.body.wroteFiles === 0);
  ck('credentials echo=never', cr.body.echo === 'never');
  ck('credentials 来源 process.env', cr.body.source === 'process.env');
  const cvals = Object.values(cr.body.configured || {});
  const evals = Object.values(cr.body.endpoints || {});
  ck('凭据状态仅布尔值（不回显）', cvals.length > 0 && cvals.concat(evals).every(function (v) { return typeof v === 'boolean'; }));
  ck('响应不含任何疑似密钥字符串', !/sk-|Bearer |api[_-]?key\s*[:=]\s*\S+/i.test(JSON.stringify(cr.body)));
  const h = await req('GET', '/api/health');
  ck('线上业务数据 never', h.body.onlineBusinessData === 'never');

  /* 2. 权限档：项目无真实目录时按最严格档 3 处理 */
  const noConfirm = await req('POST', '/api/model/task', taskBody());
  ck('档 3 未确认 403', noConfirm.status === 403 && noConfirm.body.needConfirm === true, noConfirm.status);

  const bad = await req('POST', '/api/model/task', taskBody({ slot: 'unknown', confirmed: true }));
  ck('非法能力槽位 400', bad.status === 400, bad.status);

  /* 3. 生成桥接任务包 */
  const t = await req('POST', '/api/model/task', taskBody({ confirmed: true }));
  ck('任务包 201', t.status === 201, JSON.stringify(t.body));
  ck('状态 pending', t.body.status === 'pending');
  ck('明确不调用模型', t.body.callsModel === false);
  ck('明确不消耗积分', t.body.consumesCredits === false);
  ck('任务包文件落盘', !!t.body.path && fs.existsSync(t.body.path));
  if (t.body.path && fs.existsSync(t.body.path)) createdFiles.push(t.body.path);
  if (t.body.path && fs.existsSync(t.body.path)) {
    const j = JSON.parse(fs.readFileSync(t.body.path, 'utf8'));
    ck('任务包含能力槽位与模型', j.slot === 'image' && !!j.model && !!j.channel);
    ck('任务包含提示词', j.prompt.indexOf('验收用提示词') >= 0);
    ck('任务包不含凭据值', !/sk-|Bearer |api[_-]?key/i.test(JSON.stringify(j)));
  }

  /* 4. 任务包列表 */
  const tl = await req('GET', '/api/model/tasks');
  ck('任务列表 200 且只读', tl.status === 200 && tl.body.readonly === true, tl.status);
  ck('列表含新任务且文件存在', (tl.body.tasks || []).some(function (x) { return x.id === t.body.id && x.fileExists === true; }));

  /* 5. 审计与蓝本 */
  const ops = await req('GET', '/api/ops-log');
  ck('审计含 model-task', (ops.body.lines || []).some(function (l) { return l.indexOf('model-task') >= 0; }));
  ck('蓝本文件数不变', countFiles(BLUEPRINT) === blueprintBefore, countFiles(BLUEPRINT));

  /* 6. 清理测试任务包文件（索引记录保留作审计，不覆盖既有文件） */
  createdFiles.forEach(function (f) { try { fs.unlinkSync(f); } catch (e) { /* 已删除 */ } });
  const tl2 = await req('GET', '/api/model/tasks');
  ck('清理后文件标记 false', (tl2.body.tasks || []).some(function (x) { return x.id === t.body.id && x.fileExists === false; }));
  ck('清理后蓝本仍不变', countFiles(BLUEPRINT) === blueprintBefore);
  ck('未遗留测试任务包文件', createdFiles.every(function (f) { return !fs.existsSync(f); }));

  console.log('\n==== 模型层验收：' + pass + ' PASS / ' + fail + ' FAIL ====');
  console.log('测试数据：任务包文件已删除，索引记录保留作审计；蓝本与既有项目零改动，线上零写入');
  console.log('边界：本脚本未调用任何模型、未消耗积分');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('[FATAL] ' + e.stack);
  process.exit(1);
});
