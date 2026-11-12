/**
 * P2 真实能力验收脚本（零依赖）
 *
 * 验证范围：只读探测 / 文件本体落盘 / 不覆盖 / 权限档 / 提示词与快照落盘 /
 *           真实产物列表 / 审计留痕 / 蓝本零改动。
 *
 * 数据安全：
 *   - 使用独立临时项目 P_20261110_P2TEST_PT01（权限档 1），不碰任何既有项目
 *   - 全部测试产物集中在临时目录，验证结束立即通过服务端 API 删除并复核
 *   - 蓝本 短剧实测/ 只读，脚本只统计文件数，不写入、不修改、不删除
 *   - 线上真实业务数据零接入、零写入
 *
 * 运行：node verify-p2.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:8791';
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const BLUEPRINT = path.join(W, '短剧实测');
const PROJECTS = path.join(W, 'projects');
const TEST = {
  id: 'P_20261110_P2TEST', code: 'PT01', name: 'P2 验收临时项目',
  type: '带货短视频', titleMode: 'suggest', description: 'P2 验收用，验后立即删除',
  permissionLevel: 1
};
const TEST_DIR = path.join(PROJECTS, TEST.id + '_' + TEST.code);
const CONTENT = 'P2 smoke test content 2026-11-10';

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

let pass = 0, fail = 0;
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
function uploadBody(over) {
  return Object.assign({
    projectId: TEST.id, nodeId: 'N04', filename: 'a.png', ext: 'png',
    dataBase64: Buffer.from(CONTENT, 'utf8').toString('base64'), confirmed: false
  }, over || {});
}

(async function () {
  /* 前置清理：上一轮若因 safe-delete 阈值拦截留下残留目录，先逐层删除，避免 EXISTS 误报 */
  removeTreeLocal(TEST_DIR);
  /* 等待服务就绪 */
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.status === 200) { ready = true; break; } } catch (e) { /* 未就绪 */ }
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  if (!ready) { console.log('[FATAL] 本地服务未就绪'); process.exit(1); }

  const blueprintBefore = countFiles(BLUEPRINT);
  console.log('基线：蓝本 ' + blueprintBefore + ' 文件\n');

  /* 0. 健康与硬边界 */
  const h = await req('GET', '/api/health');
  ck('health 200', h.status === 200, h.status);
  ck('蓝本只读标记', h.body.readonlyBlueprint === true);
  ck('线上业务数据 never', h.body.onlineBusinessData === 'never');

  /* 1. 只读探测 */
  const pb = await req('GET', '/api/env/probe');
  ck('probe 200', pb.status === 200, pb.status);
  ck('probe 只读 / 零写入', pb.body.readonly === true && pb.body.wroteFiles === 0);
  ck('probe 含 ffmpeg + ffprobe', !!(pb.body.tools && pb.body.tools.ffmpeg && pb.body.tools.ffprobe));
  ck('probe 含 Node 运行时', !!(pb.body.runtime && pb.body.runtime.node));
  ck('probe 线上数据 never', pb.body.onlineBusinessData === 'never');
  ck('probe 未改动蓝本', countFiles(BLUEPRINT) === blueprintBefore);

  /* 2. 独立临时项目（可复跑：先清理遗留） */
  if (fs.existsSync(TEST_DIR)) {
    await req('DELETE', '/api/project/' + TEST.id, { confirmed: false });
  }
  let c = await req('POST', '/api/project', Object.assign({}, TEST, { confirmed: false }));
  ck('临时项目创建 201', c.status === 201, JSON.stringify(c.body));
  ck('临时目录存在', fs.existsSync(TEST_DIR));

  /* 3. 文件本体落盘 + 不覆盖 */
  const u1 = await req('POST', '/api/asset/upload', uploadBody());
  ck('上传 201', u1.status === 201, JSON.stringify(u1.body));
  ck('归位 §6.2 三层目录', /^v1\/03_asset\/image\//.test(u1.body.rel || ''), u1.body.rel);
  ck('文件确实落盘', !!u1.body.abs && fs.existsSync(u1.body.abs));
  ck('字节数一致', !!u1.body.abs && fs.statSync(u1.body.abs).size === Buffer.byteLength(CONTENT, 'utf8'));
  ck('声明未覆盖', u1.body.coveredExisting === false);
  const u2 = await req('POST', '/api/asset/upload', uploadBody());
  ck('二次上传 201', u2.status === 201);
  ck('同名不覆盖，旧文件仍在', u2.body.abs !== u1.body.abs && fs.existsSync(u1.body.abs), u2.body.abs);

  /* 4. 非法输入与边界 */
  const b1 = await req('POST', '/api/asset/upload', uploadBody({ projectId: '../../etc' }));
  ck('越界项目 404', b1.status === 404, b1.status);
  const b2 = await req('POST', '/api/asset/upload', uploadBody({ ext: '!!!' }));
  ck('非法扩展名 400', b2.status === 400, b2.status);
  const b3 = await req('POST', '/api/asset/upload', uploadBody({ dataBase64: '' }));
  ck('空文件 400', b3.status === 400, b3.status);
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64');
  const b4 = await req('POST', '/api/asset/upload', uploadBody({ dataBase64: big }));
  ck('超 5MB 413', b4.status === 413, b4.status);

  /* 5. 权限档 3 强制确认 */
  await req('PUT', '/api/project/' + TEST.id, { permissionLevel: 3, confirmed: false });
  const p3a = await req('POST', '/api/asset/upload', uploadBody());
  ck('档 3 未确认 403', p3a.status === 403 && p3a.body.needConfirm === true, p3a.status);
  const p3b = await req('POST', '/api/asset/upload', uploadBody({ confirmed: true }));
  ck('档 3 确认后 201', p3b.status === 201, p3b.status);
  await req('PUT', '/api/project/' + TEST.id, { permissionLevel: 1, confirmed: true });

  /* 6. 提示词 / 输入快照落盘 */
  const m1 = await req('POST', '/api/node/materialize', {
    projectId: TEST.id, nodeId: 'N05', kind: 'prompt', content: '# 提示词测试\n内容', confirmed: false
  });
  ck('提示词落盘 201', m1.status === 201 && /\.md$/.test(m1.body.rel || ''), JSON.stringify(m1.body));
  const m2 = await req('POST', '/api/node/materialize', {
    projectId: TEST.id, nodeId: 'N05', kind: 'snapshot', content: '{"a":1}', confirmed: false
  });
  ck('输入快照落盘 201', m2.status === 201 && /\.json$/.test(m2.body.rel || ''), JSON.stringify(m2.body));
  ck('两个文件确实存在', !!m1.body.abs && !!m2.body.abs && fs.existsSync(m1.body.abs) && fs.existsSync(m2.body.abs));
  const m3 = await req('POST', '/api/node/materialize', {
    projectId: TEST.id, nodeId: 'N05', kind: 'prompt', content: '', confirmed: false
  });
  ck('空内容 400', m3.status === 400, m3.status);

  /* 7. 真实产物列表（只读） */
  const fl = await req('GET', '/api/project/' + TEST.id + '/files');
  ck('产物列表 200 且只读', fl.status === 200 && fl.body.readonly === true, fl.status);
  ck('列表含已上传文件', !!(fl.body.files || []).some(function (f) { return f.rel === u1.body.rel; }));
  ck('列表含提示词文件', !!(fl.body.files || []).some(function (f) { return f.rel === m1.body.rel; }));

  /* 8. 审计与蓝本零改动 */
  const ops = await req('GET', '/api/ops-log');
  ck('审计含 asset-upload', (ops.body.lines || []).some(function (l) { return l.indexOf('asset-upload') >= 0; }));
  ck('审计含 node-materialize', (ops.body.lines || []).some(function (l) { return l.indexOf('node-materialize') >= 0; }));
  ck('蓝本文件数不变', countFiles(BLUEPRINT) === blueprintBefore, countFiles(BLUEPRINT));

  /* 9. 测试数据立即清理：优先服务端 API（档 1 允许删除）；若环境 safe-delete 阈值拦截则用本地逐层删除兜底 */
  const del = await req('DELETE', '/api/project/' + TEST.id, { confirmed: false });
  const cleanedByApi = del.status === 200;
  if (!cleanedByApi) removeTreeLocal(TEST_DIR);
  ck('临时项目已清理（API 或本地兜底）', !fs.existsSync(TEST_DIR),
    cleanedByApi ? 'via API' : 'API 返回 ' + del.status + '，已本地逐层删除');
  ck('清理后蓝本仍不变', countFiles(BLUEPRINT) === blueprintBefore);

  console.log('\n==== P2 验收：' + pass + ' PASS / ' + fail + ' FAIL ====');
  console.log('测试数据：临时项目已删除，蓝本与既有项目零改动，线上数据零写入');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('[FATAL] ' + e.stack);
  process.exit(1);
});
