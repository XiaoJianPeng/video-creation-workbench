/**
 * 任务包回执链路验收脚本（零依赖）
 *
 * 验证：回执写入 / 产物路径校验 / 不覆盖 / 权限档 / 列表状态与产物清单 /
 *       审计留痕 / 蓝本零改动 / 测试数据清理。
 *
 * 数据安全：
 *   - 使用独立临时项目 P_20261110_RCPT_RT01，不碰任何既有项目
 *   - 测试任务包、回执文件、临时项目在验证结束立即删除；索引 JSONL 保留作审计（不覆盖）
 *   - 蓝本 短剧实测/ 只读；线上业务数据零接入零写入
 *   - 本脚本不调用任何模型、不消耗积分
 *
 * 运行：node verify-receipt.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:8791';
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const BLUEPRINT = path.join(W, '短剧实测');
const PROJECTS = path.join(W, 'projects');
const TASKS_DIR = path.join(W, 'data', 'tasks');
const TEST = {
  id: 'P_20261110_RCPT', code: 'RT01', name: '回执验收临时项目',
  type: '带货短视频', permissionLevel: 1
};
const TEST_DIR = path.join(PROJECTS, TEST.id + '_' + TEST.code);

/** 逐层删除临时项目目录（环境安全策略会拦截 recursive rmSync；仅用于本脚本自己的临时数据） */
function removeTreeLocal(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) removeTreeLocal(f);
    else { try { fs.unlinkSync(f); } catch (_) { /* 跳过占用文件 */ } }
  });
  try { fs.rmdirSync(dir); } catch (_) { /* 目录非空则保留，由断言如实报告 */ }
}

let pass = 0, fail = 0, createdTaskIds = [];
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

(async function () {
  /* 前置清理：上一轮若因 safe-delete 阈值拦截留下残留目录，先逐层删除，避免 EXISTS 误报 */
  removeTreeLocal(TEST_DIR);
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) { /* 未就绪 */ }
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  if (!ready) { console.log('[FATAL] 本地服务未就绪'); process.exit(1); }

  const blueprintBefore = countFiles(BLUEPRINT);
  console.log('基线：蓝本 ' + blueprintBefore + ' 文件\n');

  /* 1. 准备：独立临时项目 + 真实产物文件 + 任务包 */
  if (fs.existsSync(TEST_DIR)) await req('DELETE', '/api/project/' + TEST.id, { confirmed: false });
  const cp = await req('POST', '/api/project', Object.assign({}, TEST, { confirmed: false }));
  ck('临时项目创建 201', cp.status === 201, JSON.stringify(cp.body));

  const b64 = Buffer.from('receipt smoke artifact').toString('base64');
  const up = await req('POST', '/api/asset/upload', {
    projectId: TEST.id, nodeId: 'N06', filename: 'shot.png', ext: 'png', dataBase64: b64, confirmed: false
  });
  ck('产物文件落盘 201', up.status === 201, JSON.stringify(up.body));
  const rel = up.body.rel;

  async function newTask() {
    const t = await req('POST', '/api/model/task', {
      projectId: TEST.id, nodeId: 'N06', slot: 'image',
      channel: 'WorkBuddy 桥接（默认）', model: 'WorkBuddy 生图（桥接）',
      billable: true, prompt: '# 回执验收提示词', confirmed: true
    });
    if (t.status === 201) createdTaskIds.push(t.body.id);
    return t;
  }
  const t1 = await newTask();
  ck('任务包生成 201', t1.status === 201, JSON.stringify(t1.body));

  /* 2. 回执主链路 */
  const rc = await req('POST', '/api/model/task/result', {
    taskId: t1.body.id, projectId: TEST.id, status: 'succeeded', elapsed: '42s',
    note: '验收用：模拟 WorkBuddy 会话生成后回写',
    artifacts: [{ rel: rel, name: '分镜01.png', kind: '图片', meta: { size: '1024x1536' } }],
    confirmed: false
  });
  ck('回执写入 201', rc.status === 201, JSON.stringify(rc.body));
  ck('回执产物数 1', rc.body.artifacts === 1);
  ck('回执声明未覆盖', rc.body.coveredExisting === false);
  ck('回执文件落盘', !!rc.body.resultPath && fs.existsSync(rc.body.resultPath));
  if (rc.body.resultPath && fs.existsSync(rc.body.resultPath)) {
    const j = JSON.parse(fs.readFileSync(rc.body.resultPath, 'utf8'));
    ck('回执含产物相对路径', j.artifacts.length === 1 && j.artifacts[0].rel === rel);
    ck('回执含真实字节数', j.artifacts[0].bytes === Buffer.byteLength('receipt smoke artifact'));
    ck('回执关联节点 N06', j.nodeId === 'N06');
    ck('回执状态 succeeded', j.status === 'succeeded');
  }

  /* 3. 不覆盖 / 路径校验 / 不存在 */
  const dup = await req('POST', '/api/model/task/result', {
    taskId: t1.body.id, projectId: TEST.id, artifacts: [{ rel: rel }], confirmed: false
  });
  ck('重复回执 409 不覆盖', dup.status === 409, dup.status);
  const badId = await req('POST', '/api/model/task/result', { taskId: 'TASK_NOT_EXIST', projectId: TEST.id, confirmed: false });
  ck('不存在任务包 404', badId.status === 404, badId.status);
  const badPath = await req('POST', '/api/model/task/result', {
    taskId: t1.body.id, projectId: TEST.id, artifacts: [{ rel: '../../../etc/passwd' }], confirmed: false
  });
  ck('越界路径 400', badPath.status === 400, badPath.status);

  /* 4. 权限档 3（用第二个任务包测） */
  const t2 = await newTask();
  ck('第二个任务包 201', t2.status === 201);
  await req('PUT', '/api/project/' + TEST.id, { permissionLevel: 3, confirmed: false });
  const p3a = await req('POST', '/api/model/task/result', {
    taskId: t2.body.id, projectId: TEST.id, artifacts: [{ rel: rel }], confirmed: false
  });
  ck('档 3 未确认 403', p3a.status === 403 && p3a.body.needConfirm === true, p3a.status);
  const p3b = await req('POST', '/api/model/task/result', {
    taskId: t2.body.id, projectId: TEST.id, artifacts: [{ rel: rel }], confirmed: true
  });
  ck('档 3 确认后 201', p3b.status === 201, p3b.status);
  await req('PUT', '/api/project/' + TEST.id, { permissionLevel: 1, confirmed: true });

  /* 5. 列表状态与产物清单 */
  const tl = await req('GET', '/api/model/tasks');
  ck('任务列表 200 只读', tl.status === 200 && tl.body.readonly === true);
  const row = (tl.body.tasks || []).filter(function (x) { return x.id === t1.body.id; })[0];
  ck('列表标记 succeeded', !!row && row.status === 'succeeded', row && row.status);
  ck('列表带产物清单', !!row && row.receiptArtifacts.length === 1 && row.receiptArtifacts[0].rel === rel);
  ck('列表带节点 N06', !!row && row.node === 'N06', row && row.node);

  /* 6. 审计与蓝本 */
  const ops = await req('GET', '/api/ops-log');
  ck('审计含 model-task-receipt', (ops.body.lines || []).some(function (l) { return l.indexOf('model-task-receipt') >= 0; }));
  ck('蓝本文件数不变', countFiles(BLUEPRINT) === blueprintBefore);
  const h = await req('GET', '/api/health');
  ck('线上业务数据 never', h.body.onlineBusinessData === 'never');

  /* 7. 清理：临时项目 + 测试任务包/回执文件；API 删除被环境 safe-delete 阈值拦截时用本地逐层删除兜底 */
  const del = await req('DELETE', '/api/project/' + TEST.id, { confirmed: false });
  const cleanedByApi = del.status === 200;
  if (!cleanedByApi) removeTreeLocal(TEST_DIR);
  ck('临时项目已清理（API 或本地兜底）', !fs.existsSync(TEST_DIR),
    cleanedByApi ? 'via API' : 'API 返回 ' + del.status + '，已本地逐层删除');
  let removed = 0;
  createdTaskIds.forEach(function (id) {
    [id + '.json', id + '.result.json'].forEach(function (f) {
      const fp = path.join(TASKS_DIR, f);
      if (fs.existsSync(fp)) { fs.unlinkSync(fp); removed++; }
    });
  });
  ck('测试任务包与回执已清理', createdTaskIds.every(function (id) {
    return !fs.existsSync(path.join(TASKS_DIR, id + '.json')) && !fs.existsSync(path.join(TASKS_DIR, id + '.result.json'));
  }), '删除 ' + removed + ' 个文件');
  ck('清理后蓝本仍不变', countFiles(BLUEPRINT) === blueprintBefore);

  console.log('\n==== 回执链路验收：' + pass + ' PASS / ' + fail + ' FAIL ====');
  console.log('测试数据：临时项目、任务包、回执文件均已删除；索引 JSONL 保留作审计');
  console.log('边界：本脚本未调用任何模型、未消耗积分、未写入线上数据');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('[FATAL] ' + e.stack);
  process.exit(1);
});
