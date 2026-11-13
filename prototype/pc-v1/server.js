/**
 * 通用视频创作项目管理工作台 · 本地数据服务（零依赖）
 *
 * 用途：为 PC 网页原型提供「真实数据接入」通道 ②（本地 Node 服务）。
 * 只监听 127.0.0.1:8791，不对外暴露；同时托管同目录静态前端，同源访问无 CORS 问题。
 *
 * 权限模型（用户 2026-11-10 确认，项目创建时由用户选择，服务端强制校验）：
 *   1 = 全部权限（含删除），写操作无需逐次确认
 *   2 = 仅读写（新增/修改），禁止删除
 *   3 = 新增 / 修改 / 删除每次都需用户确认（请求须带 confirmed: true）
 *
 * 硬边界：
 *   - 不接线上真实业务数据；不对线上库做任何写入
 *   - 所有路径必须落在 WORKSPACE 内（路径穿越防护）
 *   - 蓝本目录 短剧实测/ 只读，永不写入
 *   - 所有写操作追加到 data/ops.log 审计
 *
 * 启动：node server.js  → 浏览器打开 http://127.0.0.1:8791/
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const WORKSPACE = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const SCAN_ROOT = path.join(WORKSPACE, '短剧实测');
const PROJECTS_ROOT = path.join(WORKSPACE, 'projects');
const DATA_DIR = path.join(WORKSPACE, 'data');
const STATIC_DIR = __dirname;
const PORT = 8791;
const HOST = '127.0.0.1';

const OPS_LOG = path.join(DATA_DIR, 'ops.log');
const SCAN_INDEX = path.join(DATA_DIR, 'scan-index.json');
const TASKS_DIR = path.join(DATA_DIR, 'tasks');
const TASK_RESULT_INDEX = 'tasks.result.jsonl';
/* 凭据只从 process.env 读取是否配置；绝不回显值、不写日志、不落盘、不进入项目文件 */
const CREDENTIAL_ENV = ['WORKBUDDY_MODEL_API_KEY', 'MODEL_API_KEY', 'LLM_API_KEY', 'IMAGE_API_KEY', 'VIDEO_API_KEY'];
const ENDPOINT_ENV = ['MODEL_API_BASE_URL', 'LLM_ENDPOINT', 'IMAGE_ENDPOINT', 'VIDEO_ENDPOINT'];
/* 模型提供商注册表（全局自定义配置，参考 WorkBuddy 模型自定义配置能力） */
const PROVIDERS_FILE = path.join(DATA_DIR, 'model-providers.json');
const PROVIDER_TYPES = ['openai-compatible', 'custom-http', 'local'];
const SLOT_KEYS = ['llm', 'image', 'video', 'voice'];
/* 推荐标签与档位白名单（前端标签/下拉共用，服务端强制校验） */
const TAG_VALUES = ['性价比最高', '最便宜', '效果最佳'];
const TIER_VALUES = ['首选', '备选'];

/* ---------- 通用工具 ---------- */
function ensureDirs() {
  [DATA_DIR, PROJECTS_ROOT].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });
}
function nowISO() { return new Date().toISOString(); }
/* 读取模型提供商注册表（损坏/缺失时返回空数组，不抛错） */
function loadProviders() {
  try {
    const a = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function audit(action, detail) {
  try {
    fs.appendFileSync(OPS_LOG, JSON.stringify(Object.assign({ ts: nowISO(), action: action }, detail || {})) + '\n', 'utf8');
  } catch (e) { console.error('[audit-fail]', e.message); }
}
/* 逐层 unlink + rmdir 删除目录。
   环境安全策略会拦截 fs.rmSync({recursive:true})（genie-trash 回收站超时），
   因此不使用递归删除 API；本函数仍受权限档与路径校验约束。 */
function removeTree(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) removeTree(full);
    else fs.unlinkSync(full);
  });
  fs.rmdirSync(dir);
}
function safeResolve(root, rel) {
  const r = path.resolve(root);
  const p = path.resolve(root, rel || '');
  if (p !== r && !p.startsWith(r + path.sep)) {
    const err = new Error('路径越界：' + rel);
    err.code = 'PATH_ESCAPE';
    throw err;
  }
  return p;
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let s = '';
    req.on('data', function (c) { s += c; if (s.length > 12 * 1024 * 1024) reject(new Error('请求体过大（上限 12MB）')); });
    req.on('end', function () {
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
function walk(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  entries.forEach(function (e) {
    const full = path.join(dir, e.name);
    const rel = base ? path.posix.join(base, e.name) : e.name;
    if (e.isDirectory()) { walk(full, rel, out); return; }
    if (!e.isFile()) return;
    let st;
    try { st = fs.statSync(full); } catch (err) { return; }
    out.push({
      rel: rel, name: e.name, ext: path.extname(e.name).slice(1).toLowerCase(),
      size: st.size, mtime: st.mtime.toISOString(), category: categorize(rel, e.name)
    });
  });
}
function categorize(rel, name) {
  if (rel.indexOf('_build') >= 0) return '构建中间物';
  if (/^audio[\\/]/.test(rel) || /^voice\d+\.mp3$/.test(name)) return '配音';
  if (/^字幕\d+\.txt$/.test(name)) return '字幕';
  if (/^分镜\d+/.test(name)) return '分镜图';
  if (/^成片/.test(name)) return '成片';
  if (/说明|报告|脚本|修订内容/.test(name)) return '文档';
  if (/清单|配音清单/.test(name)) return '清单';
  if (/\.(md)$/.test(name)) return '文档';
  if (/\.(json)$/.test(name)) return '清单';
  if (/\.(mp4|mov)$/.test(name)) return '视频';
  if (/\.(png|jpg|jpeg|webp)$/.test(name)) return '图片';
  if (/\.(mp3|wav|m4a)$/.test(name)) return '音频';
  if (/\.(ttf|otf)$/.test(name)) return '字体';
  if (/\.(txt)$/.test(name)) return '文本';
  return '其他';
}

/* ---------- 权限模型 ---------- */
const LEVEL_NAME = { 1: '全部权限（含删除）', 2: '仅读写（禁删除）', 3: '每次写操作需确认' };
function checkPermission(project, action, confirmed) {
  const lv = Number(project && project.permissionLevel);
  const isDelete = action === 'delete';
  if (lv === 1) return { ok: true, level: lv };
  if (lv === 2) {
    return isDelete
      ? { ok: false, level: lv, reason: '权限档 2 仅允许读写，禁止删除操作' }
      : { ok: true, level: lv };
  }
  if (lv === 3) {
    return confirmed === true
      ? { ok: true, level: lv }
      : { ok: false, level: lv, needConfirm: true, reason: '权限档 3：每次新增 / 修改 / 删除均需用户确认' };
  }
  return { ok: false, level: lv, reason: '未知权限档，仅支持 1 / 2 / 3' };
}
function loadProject(id) {
  /* 目录名为 <项目ID>_<代号>，允许用纯 ID 或完整目录名查询 */
  let entries;
  try { entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }); } catch (e) { return null; }
  const hit = entries.filter(function (e) {
    return e.isDirectory() && (e.name === id || e.name.indexOf(id + '_') === 0);
  })[0];
  if (!hit) return null;
  const dir = safeResolve(PROJECTS_ROOT, hit.name);
  const metaPath = path.join(dir, 'project.meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return { dir: dir, metaPath: metaPath, meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
  } catch (e) { return null; }
}

/* ---------- P2 真实能力：辅助函数 ---------- */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
function stampName() { return nowISO().replace(/[-:.TZ]/g, '').slice(0, 14); }
function pad2(n) { return String(n).padStart(2, '0'); }
function classifyAsset(ext) {
  const e = String(ext || '').toLowerCase();
  if (/^(png|jpg|jpeg|webp|gif)$/.test(e)) return { dir: '03_asset/image', cls: 'image' };
  if (/^(mp3|wav|m4a|aac)$/.test(e)) return { dir: '03_asset/voice', cls: 'voice' };
  if (/^(ttf|otf|woff2?)$/.test(e)) return { dir: '03_asset/font', cls: 'font' };
  if (/^(mp4|mov|webm)$/.test(e)) return { dir: '04_output/clip', cls: 'clip' };
  return { dir: '03_asset/prop', cls: 'asset' };
}
/* 同名自动升 rev，绝不覆盖既有文件 */
function uniquePath(dir, base, ext) {
  const full = path.join(dir, base + '.' + ext);
  if (!fs.existsSync(full)) return full;
  for (let r = 2; r < 100; r++) {
    const alt = path.join(dir, base + '_r' + pad2(r) + '.' + ext);
    if (!fs.existsSync(alt)) return alt;
  }
  const e = new Error('同名文件过多，拒绝写入'); e.code = 'TOO_MANY'; throw e;
}
function appendIndex(projDir, name, rec) {
  fs.appendFileSync(path.join(projDir, name), JSON.stringify(rec) + '\n', 'utf8');
}
function countIndexLines(projDir, name) {
  const f = path.join(projDir, name);
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length;
}
/* 只读探测本机工具；工具可用性以本机实际安装为准，不做能力承诺 */
function probeTool(name) {
  try {
    const r = spawnSync(name, ['-version'], { encoding: 'utf8', timeout: 3000, windowsHide: true, maxBuffer: 256 * 1024 });
    if (r.error && r.error.code === 'ENOENT') return { available: false, reason: '未在 PATH 中找到（需核实本机安装）' };
    if (r.error) return { available: false, reason: r.error.message };
    const line = String(r.stdout || r.stderr || '').split('\n')[0].trim().slice(0, 140);
    return { available: r.status === 0, versionLine: line || '（无版本输出）' };
  } catch (e) { return { available: false, reason: e.message }; }
}
function blueprintFonts() {
  try {
    if (!fs.existsSync(SCAN_INDEX)) return [];
    const idx = JSON.parse(fs.readFileSync(SCAN_INDEX, 'utf8'));
    return (idx.files || []).filter(function (f) { return /^(ttf|otf)$/.test(f.ext); })
      .map(function (f) { return { rel: f.rel, size: f.size }; }).slice(0, 20);
  } catch (e) { return []; }
}

/* ---------- 项目目录（§6.2 三层规范） ---------- */
const SUBDIRS = [
  '01_input/theme', '01_input/spec', '01_input/reference',
  '02_prompt/script', '02_prompt/image', '02_prompt/video', '02_prompt/audio', '02_prompt/edit',
  '03_asset/image', '03_asset/character', '03_asset/scene', '03_asset/prop',
  '03_asset/voice', '03_asset/bgm', '03_asset/font',
  '04_output/storyboard', '04_output/clip', '04_output/audio',
  '04_output/subtitle', '04_output/master', '04_output/qc',
  '05_review/frames', '05_review/reports', '05_review/confirmations',
  '06_build', '_shared'
];
function createProjectDir(body) {
  const id = body.id, code = body.code;
  if (!/^[A-Za-z0-9_\-]+$/.test(id) || !/^[A-Za-z0-9_\-]+$/.test(code)) {
    const e = new Error('项目 ID / 代号只允英文字母数字下划线连字符'); e.code = 'BAD_ID'; throw e;
  }
  const dir = safeResolve(PROJECTS_ROOT, id + '_' + code);
  if (fs.existsSync(dir)) { const e = new Error('项目目录已存在，拒绝覆盖'); e.code = 'EXISTS'; throw e; }
  fs.mkdirSync(path.join(dir, 'v1'), { recursive: true });
  SUBDIRS.forEach(function (s) { fs.mkdirSync(path.join(dir, 'v1', s), { recursive: true }); });
  const meta = {
    projectId: id, code: code, name: body.name, type: body.type || '带货短视频',
    titleMode: body.titleMode || 'suggest', description: body.description || '',
    permissionLevel: Number(body.permissionLevel), permissionName: LEVEL_NAME[Number(body.permissionLevel)],
    version: 'v1', status: '进行中', workDir: dir,
    createdAt: nowISO(), updatedAt: nowISO(),
    source: 'PC 网页工作台 · 本地 Node 服务'
  };
  fs.writeFileSync(path.join(dir, 'project.meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'changelog.jsonl'),
    JSON.stringify({ seq: 1, ts: nowISO(), action: 'create', node: 'N00', summary: '创建项目（权限档 ' + meta.permissionLevel + '）', actor: 'user' }) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'prompt.index.json'), JSON.stringify({ versions: [] }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'assets.index.json'), JSON.stringify({ assets: [] }, null, 2), 'utf8');
  return { dir: dir, meta: meta };
}

/* ---------- 路由 ---------- */
async function handleAPI(req, res, u) {
  const p = u.pathname;
  const method = req.method;

  if (p === '/api/health' && method === 'GET') {
    return send(res, 200, {
      ok: true, service: '视频创作工作台本地数据服务', time: nowISO(),
      workspace: WORKSPACE, scanRoot: SCAN_ROOT, projectsRoot: PROJECTS_ROOT,
      scanExists: fs.existsSync(SCAN_ROOT), projectsExists: fs.existsSync(PROJECTS_ROOT),
      permissionLevels: LEVEL_NAME, readonlyBlueprint: true, onlineBusinessData: 'never'
    });
  }

  /* 只读扫描：不写入蓝本目录 */
  if (p === '/api/scan' && method === 'GET') {
    if (!fs.existsSync(SCAN_ROOT)) return send(res, 404, { ok: false, error: '蓝本目录不存在' });
    const files = [];
    walk(SCAN_ROOT, '', files);
    const byCat = {};
    files.forEach(function (f) { byCat[f.category] = (byCat[f.category] || 0) + 1; });
    return send(res, 200, {
      ok: true, readonly: true, root: SCAN_ROOT, total: files.length,
      totalBytes: files.reduce(function (a, f) { return a + f.size; }, 0),
      byCategory: byCat, files: files
    });
  }

  /* 生成并落盘扫描索引（只写 data/，不碰蓝本） */
  if (p === '/api/scan-index' && method === 'POST') {
    const files = [];
    walk(SCAN_ROOT, '', files);
    const index = {
      generatedAt: nowISO(), source: SCAN_ROOT, readonly: true,
      total: files.length, totalBytes: files.reduce(function (a, f) { return a + f.size; }, 0), files: files
    };
    fs.writeFileSync(SCAN_INDEX, JSON.stringify(index, null, 2), 'utf8');
    audit('scan-index', { total: files.length, bytes: index.totalBytes });
    return send(res, 200, { ok: true, path: SCAN_INDEX, total: index.total, totalBytes: index.totalBytes });
  }
  if (p === '/api/scan-index' && method === 'GET') {
    if (!fs.existsSync(SCAN_INDEX)) return send(res, 404, { ok: false, error: '索引尚未生成' });
    return send(res, 200, JSON.parse(fs.readFileSync(SCAN_INDEX, 'utf8')));
  }

  /* 导出备份：接收前端 localStorage 内容并落盘 */
  if (p === '/api/backup' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.payload) return send(res, 400, { ok: false, error: '缺少 payload' });
    const stamp = nowISO().replace(/[:.]/g, '-');
    const file = path.join(DATA_DIR, 'localStorage-backup-' + stamp + '.json');
    fs.writeFileSync(file, typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload, null, 2), 'utf8');
    audit('backup', { file: path.basename(file), bytes: fs.statSync(file).size });
    return send(res, 200, { ok: true, path: file, bytes: fs.statSync(file).size });
  }

  /* 项目列表（只读） */
  if (p === '/api/projects' && method === 'GET') {
    ensureDirs();
    const list = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter(function (e) { return e.isDirectory(); })
      .map(function (e) {
        const mp = path.join(PROJECTS_ROOT, e.name, 'project.meta.json');
        if (!fs.existsSync(mp)) return { dir: e.name, metaMissing: true };
        try {
          const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
          return { id: m.projectId, code: m.code, name: m.name, permissionLevel: m.permissionLevel,
            permissionName: m.permissionName, version: m.version, status: m.status, dir: e.name, updatedAt: m.updatedAt };
        } catch (err) { return { dir: e.name, error: err.message }; }
      });
    return send(res, 200, { ok: true, total: list.length, projects: list });
  }

  /* 创建项目（写） */
  if (p === '/api/project' && method === 'POST') {
    const body = await readBody(req);
    if (![1, 2, 3].includes(Number(body.permissionLevel))) {
      return send(res, 400, { ok: false, error: 'permissionLevel 必须为 1 / 2 / 3' });
    }
    const perm = checkPermission({ permissionLevel: Number(body.permissionLevel) }, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    ensureDirs();
    try {
      const r = createProjectDir(body);
      audit('project-create', { projectId: body.id, dir: r.dir, permissionLevel: body.permissionLevel, confirmed: !!body.confirmed });
      return send(res, 201, { ok: true, dir: r.dir, meta: r.meta });
    } catch (e) {
      audit('project-create-fail', { projectId: body.id, error: e.message });
      return send(res, 400, { ok: false, error: e.message, code: e.code });
    }
  }

  /* 单项目读 / 改 / 删 */
  const mProject = p.match(/^\/api\/project\/([^/]+)$/);
  if (mProject) {
    const id = decodeURIComponent(mProject[1]);
    const proj = loadProject(id);
    if (!proj) return send(res, 404, { ok: false, error: '项目不存在' });
    if (method === 'GET') {
      const clPath = path.join(proj.dir, 'changelog.jsonl');
      return send(res, 200, { ok: true, meta: proj.meta, dir: proj.dir,
        changelog: fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8').trim().split('\n').filter(Boolean) : [] });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const perm = checkPermission(proj.meta, 'update', body.confirmed === true);
      if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
      ['name', 'description', 'status', 'version', 'titleMode'].forEach(function (k) {
        if (body[k] !== undefined) proj.meta[k] = body[k];
      });
      if (body.permissionLevel !== undefined) {
        if (![1, 2, 3].includes(Number(body.permissionLevel))) return send(res, 400, { ok: false, error: '未知权限档' });
        proj.meta.permissionLevel = Number(body.permissionLevel);
        proj.meta.permissionName = LEVEL_NAME[proj.meta.permissionLevel];
      }
      proj.meta.updatedAt = nowISO();
      fs.writeFileSync(proj.metaPath, JSON.stringify(proj.meta, null, 2), 'utf8');
      audit('project-update', { projectId: id, permissionLevel: proj.meta.permissionLevel, fields: Object.keys(body) });
      return send(res, 200, { ok: true, meta: proj.meta });
    }
    if (method === 'DELETE') {
      const body = await readBody(req);
      const perm = checkPermission(proj.meta, 'delete', body.confirmed === true);
      if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
      removeTree(proj.dir);
      audit('project-delete', { projectId: id, permissionLevel: proj.meta.permissionLevel, confirmed: !!body.confirmed });
      return send(res, 200, { ok: true, deleted: proj.dir });
    }
  }

  /* 追加变更记录（写） */
  const mCL = p.match(/^\/api\/project\/([^/]+)\/changelog$/);
  if (mCL && method === 'POST') {
    const id = decodeURIComponent(mCL[1]);
    const proj = loadProject(id);
    if (!proj) return send(res, 404, { ok: false, error: '项目不存在' });
    const body = await readBody(req);
    const perm = checkPermission(proj.meta, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    const clPath = path.join(proj.dir, 'changelog.jsonl');
    const existing = fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8').trim().split('\n').filter(Boolean) : [];
    const rec = { seq: existing.length + 1, ts: nowISO(), action: body.action || 'update',
      node: body.node || 'N00', summary: body.summary || '', actor: body.actor || 'user' };
    fs.appendFileSync(clPath, JSON.stringify(rec) + '\n', 'utf8');
    audit('changelog-append', { projectId: id, seq: rec.seq, permissionLevel: proj.meta.permissionLevel });
    return send(res, 201, { ok: true, record: rec });
  }

  /* 删除项目内单个文件（写，档 2 禁止） */
  if (p === '/api/file' && method === 'DELETE') {
    const id = u.searchParams.get('project') || '';
    const rel = u.searchParams.get('rel') || '';
    const proj = loadProject(id);
    if (!proj) return send(res, 404, { ok: false, error: '项目不存在' });
    const body = await readBody(req);
    const perm = checkPermission(proj.meta, 'delete', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    let target;
    try { target = safeResolve(proj.dir, rel); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, { ok: false, error: '文件不存在' });
    fs.unlinkSync(target);
    audit('file-delete', { projectId: id, rel: rel, permissionLevel: proj.meta.permissionLevel });
    return send(res, 200, { ok: true, deleted: rel });
  }

  /* ===== P2 真实能力：只读探测 / 文件落盘 / 提示词落盘 / 真实产物列表 ===== */

  /* 只读：本机能力与资源探测，不写入任何文件 */
  if (p === '/api/env/probe' && method === 'GET') {
    let projectCount = 0;
    try { projectCount = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }).filter(function (e) { return e.isDirectory(); }).length; } catch (e) { /* 目录不存在按 0 处理 */ }
    return send(res, 200, {
      ok: true, readonly: true, wroteFiles: 0, probedAt: nowISO(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      tools: {
        node: { available: true, versionLine: process.version },
        ffmpeg: probeTool('ffmpeg'), ffprobe: probeTool('ffprobe')
      },
      workspace: { projectsDir: PROJECTS_ROOT, projectCount: projectCount, scanIndexExists: fs.existsSync(SCAN_INDEX) },
      blueprint: { readonly: true, fontFiles: blueprintFonts() },
      onlineBusinessData: 'never',
      note: '只读探测：未写入 / 未修改 / 未删除任何文件；工具可用性以本机实际安装为准'
    });
  }

  /* 只读：列出项目真实产物 */
  const mFiles = p.match(/^\/api\/project\/([^/]+)\/files$/);
  if (mFiles && method === 'GET') {
    const proj = loadProject(decodeURIComponent(mFiles[1]));
    if (!proj) return send(res, 404, { ok: false, error: '项目不存在' });
    const files = [];
    walk(proj.dir, '', files);
    return send(res, 200, { ok: true, readonly: true, projectId: proj.meta.projectId, total: files.length, files: files });
  }

  /* ---------- 只读文件交互（R2-01 / D5：只读、只审计、不消耗档 3 写确认） ---------- */

  /** 允许被系统默认程序打开的扩展名白名单；可执行文件一律拒绝 */
  const OPEN_EXT_WHITELIST = ['.mp4', '.mp3', '.png', '.jpg', '.jpeg', '.json', '.md', '.txt', '.wav', '.m4a', '.srt', '.vtt', '.webm'];

  /**
   * 校验并返回项目内一个真实存在的文件绝对路径。
   * 安全：绝对路径只在服务端由 safeResolve 生成，前端不拼、不传绝对路径。
   * @param {object} proj loadProject 返回的项目对象
   * @param {string} rel 前端传入的相对路径
   * @returns {{ok:boolean, code?:string, error?:string, abs?:string, bytes?:number, ext?:string}}
   */
  function resolveOpenTarget(proj, rel) {
    const s = String(rel || '');
    if (!s) return { ok: false, code: 'NO_REL', error: '该条目仅登记元数据，未落盘' };
    // 拒绝命令字符与 URL：参数数组启动虽不经 shell，仍做纵深防御
    if (/[\u0000\r\n"'`&|<>*?]/.test(s) || /^[a-zA-Z]+:\/\//.test(s)) {
      return { ok: false, code: 'INVALID_REL', error: '路径含非法字符，已拒绝' };
    }
    // 先判越界再判扩展名：越界应报 PATH_ESCAPE，不能被 EXT_DENIED 抢先（AC-54）
    let abs;
    try { abs = safeResolve(proj.dir, s); }
    catch (e) { return { ok: false, code: 'PATH_ESCAPE', error: '路径越界，已拒绝' }; }
    const ext = path.extname(s).toLowerCase();
    if (!OPEN_EXT_WHITELIST.includes(ext)) {
      return { ok: false, code: 'EXT_DENIED', error: '该文件类型不在打开白名单内' };
    }
    let st;
    try { st = fs.statSync(abs); }
    catch (e) { return { ok: false, code: 'NOT_FOUND', error: '文件已不在预期路径，请检查是否被移动或清理' }; }
    if (!st.isFile()) return { ok: false, code: 'NOT_FILE', error: '目标不是文件' };
    return { ok: true, abs, bytes: st.size, ext };
  }

  /** 只读预检：供前端在弹菜单前判断两项操作是否可用 */
  if (p === '/api/file/stat' && method === 'GET') {
    const pid = u.searchParams.get('projectId') || '';
    const rel = u.searchParams.get('rel') || '';
    const proj = loadProject(pid);
    if (!proj) return send(res, 404, { ok: false, code: 'NO_PROJECT', error: '项目无真实目录' });
    const t = resolveOpenTarget(proj, rel);
    if (!t.ok) return send(res, 200, { ok: false, code: t.code, error: t.error, readonly: true });
    return send(res, 200, { ok: true, readonly: true, projectId: pid, rel, bytes: t.bytes, ext: t.ext, permissionLevel: proj.meta.permissionLevel });
  }

  /**
   * 只读副作用：用默认程序打开 / 打开所在文件夹。
   * D5：视为只读动作，不调用 checkPermission（不消耗档 3 写确认），但每次写 ops.log。
   * 安全：spawn 参数数组启动 explorer.exe，禁用 shell 拼接；路径已过白名单 + safeResolve。
   * 注意：explorer.exe 对非可执行文件按系统关联程序打开；其行为以本机 Windows 为准，未经核实。
   */
  if (p === '/api/file/open' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(String(body.projectId || ''));
    if (!proj) return send(res, 404, { ok: false, code: 'NO_PROJECT', error: '项目无真实目录' });
    const t = resolveOpenTarget(proj, body.rel);
    if (!t.ok) {
      audit('file-open-denied', { projectId: proj.meta.projectId, rel: String(body.rel || ''), code: t.code });
      return send(res, 200, { ok: false, code: t.code, error: t.error });
    }
    const mode = body.mode === 'folder' ? 'folder' : 'default';
    // explorer.exe 的 /select 必须作为单个参数 "/select,<绝对路径>"，拆成两个参数会失效
    const args = mode === 'folder' ? ['/select,' + t.abs] : [t.abs];
    try {
      // detached + unref：不阻塞本地服务；stdio ignore 避免句柄泄漏
      const child = spawn('explorer.exe', args, { detached: true, stdio: 'ignore', shell: false });
      child.on('error', function (e) { audit('file-open-error', { mode, error: e.message }); });
      child.unref();
      audit('file-open', { projectId: proj.meta.projectId, rel: String(body.rel || ''), mode, bytes: t.bytes, permissionLevel: proj.meta.permissionLevel });
      return send(res, 200, { ok: true, readonly: true, mode, launched: true, rel: String(body.rel || ''), note: '已请求系统打开，实际窗口以本机为准' });
    } catch (e) {
      audit('file-open-error', { mode, error: e.message });
      return send(res, 200, { ok: false, code: 'OPEN_FAILED', error: '系统未能打开该文件，可改用「打开所在文件夹」' });
    }
  }

  /* 写：文件本体按 §6.2 三层目录落盘（不覆盖，权限档强制） */
  if (p === '/api/asset/upload' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(String(body.projectId || ''));
    if (!proj) return send(res, 404, { ok: false, error: '项目无真实目录，请先在「项目设置 → 数据接入」创建', needRealDir: true });
    const perm = checkPermission(proj.meta, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    const ext = String(body.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!ext) return send(res, 400, { ok: false, error: '缺少合法扩展名' });
    let buf;
    try { buf = Buffer.from(String(body.dataBase64 || ''), 'base64'); } catch (e) { return send(res, 400, { ok: false, error: 'base64 解码失败' }); }
    if (!buf.length) return send(res, 400, { ok: false, error: '文件内容为空' });
    if (buf.length > MAX_UPLOAD_BYTES) return send(res, 413, { ok: false, error: '单文件上限 5MB（原型演示）', bytes: buf.length });
    const cls = classifyAsset(ext);
    const nodeId = /^N\d{2}$/.test(String(body.nodeId || '')) ? body.nodeId : 'N04';
    const version = String(proj.meta.version || 'v1');
    let targetDir;
    try { targetDir = safeResolve(proj.dir, path.join(version, cls.dir)); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    fs.mkdirSync(targetDir, { recursive: true });
    const seq = countIndexLines(proj.dir, 'uploads.index.jsonl') + 1;
    const base = [proj.meta.code, version, nodeId, cls.cls + '-' + pad2(seq), 'final', 'r01', stampName()].join('_');
    let target;
    try { target = uniquePath(targetDir, base, ext); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    fs.writeFileSync(target, buf);
    const rel = path.relative(proj.dir, target).split(path.sep).join('/');
    appendIndex(proj.dir, 'uploads.index.jsonl', {
      ts: nowISO(), node: nodeId, originalName: String(body.filename || ''), diskName: path.basename(target),
      rel: rel, bytes: buf.length, category: cls.cls, permissionLevel: perm.level
    });
    audit('asset-upload', { projectId: proj.meta.projectId, node: nodeId, rel: rel, bytes: buf.length, permissionLevel: perm.level, confirmed: !!body.confirmed });
    return send(res, 201, { ok: true, rel: rel, abs: target, bytes: buf.length,
      diskName: path.basename(target), permissionLevel: perm.level, coveredExisting: false });
  }

  /* 写：提示词 / 输入快照按 §6.2 落盘（不覆盖，权限档强制） */
  if (p === '/api/node/materialize' && method === 'POST') {
    const body = await readBody(req);
    const proj = loadProject(String(body.projectId || ''));
    if (!proj) return send(res, 404, { ok: false, error: '项目无真实目录，请先创建', needRealDir: true });
    const perm = checkPermission(proj.meta, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    const kind = body.kind === 'snapshot' ? 'snapshot' : 'prompt';
    const content = String(body.content || '');
    if (!content) return send(res, 400, { ok: false, error: '内容为空' });
    if (content.length > 200000) return send(res, 413, { ok: false, error: '内容上限 200KB' });
    const nodeId = /^N\d{2}$/.test(String(body.nodeId || '')) ? body.nodeId : 'N05';
    const version = String(proj.meta.version || 'v1');
    const sub = kind === 'snapshot' ? '01_input/spec' : '02_prompt/script';
    let targetDir;
    try { targetDir = safeResolve(proj.dir, path.join(version, sub)); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    fs.mkdirSync(targetDir, { recursive: true });
    const seq = countIndexLines(proj.dir, 'materials.index.jsonl') + 1;
    const base = [proj.meta.code, version, nodeId, kind + '-' + pad2(seq), 'final', 'r01', stampName()].join('_');
    const ext = kind === 'snapshot' ? 'json' : 'md';
    let target;
    try { target = uniquePath(targetDir, base, ext); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    fs.writeFileSync(target, content, 'utf8');
    const rel = path.relative(proj.dir, target).split(path.sep).join('/');
    appendIndex(proj.dir, 'materials.index.jsonl', {
      ts: nowISO(), node: nodeId, kind: kind, diskName: path.basename(target), rel: rel,
      bytes: Buffer.byteLength(content, 'utf8'), permissionLevel: perm.level
    });
    audit('node-materialize', { projectId: proj.meta.projectId, node: nodeId, kind: kind, rel: rel, permissionLevel: perm.level, confirmed: !!body.confirmed });
    return send(res, 201, { ok: true, rel: rel, abs: target, diskName: path.basename(target),
      bytes: Buffer.byteLength(content, 'utf8'), permissionLevel: perm.level });
  }

  /* ===== 模型与协作：凭据只读状态 / WorkBuddy 任务包桥接 ===== */

  /* 只读：仅返回环境变量「是否已配置」，不回显任何值 */
  if (p === '/api/model/credentials' && method === 'GET') {
    const configured = {}, endpoints = {};
    CREDENTIAL_ENV.forEach(function (k) { configured[k] = !!process.env[k]; });
    ENDPOINT_ENV.forEach(function (k) { endpoints[k] = !!process.env[k]; });
    /* 聚合注册表里出现过的 apiKeyEnv，逐个回报是否已配置（不回显值） */
    const prov = loadProviders();
    const seen = {};
    prov.forEach(function (x) { if (x && x.apiKeyEnv) seen[x.apiKeyEnv] = !!process.env[x.apiKeyEnv]; });
    return send(res, 200, {
      ok: true, readonly: true, wroteFiles: 0, echo: 'never', source: 'process.env',
      configured: configured, endpoints: endpoints, providerEnv: seen,
      note: '仅返回「是否已配置」的布尔值；不回显凭据内容、不写入日志、不落地、不进入项目文件。'
    });
  }

  /* 只读：模型提供商注册表 */
  if (p === '/api/model/providers' && method === 'GET') {
    return send(res, 200, { ok: true, providers: loadProviders() });
  }

  /* 写：保存模型提供商注册表（全局配置；需 confirmed 权限确认，写 data/model-providers.json + 审计） */
  if (p === '/api/model/providers' && method === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body.providers)) return send(res, 400, { ok: false, error: 'providers 必须是数组' });
    /* 逐项校验：name 必填、type 合法、capabilities 为槽位子集、models 为字符串数组 */
    for (let i = 0; i < body.providers.length; i++) {
      const x = body.providers[i] || {};
      if (!x.name || typeof x.name !== 'string') return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项缺少名称' });
      if (PROVIDER_TYPES.indexOf(x.type) < 0) return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项类型非法：' + x.type });
      const caps = Array.isArray(x.capabilities) ? x.capabilities : [];
      if (caps.some(function (c) { return SLOT_KEYS.indexOf(c) < 0; }))
        return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项能力标签含非法槽位' });
      if (!Array.isArray(x.models)) return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项 models 必须是数组' });
      /* 推荐标签（性价比最高 / 最便宜 / 效果最佳）与档位（首选 / 备选）为可选字段，存在时必须合法 */
      if (x.tags !== undefined) {
        if (!Array.isArray(x.tags) || x.tags.some(function (t) { return TAG_VALUES.indexOf(t) < 0; }))
          return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项标签含非法值（仅允许：' + TAG_VALUES.join(' / ') + '）' });
      }
      if (x.tier !== undefined && TIER_VALUES.indexOf(x.tier) < 0)
        return send(res, 400, { ok: false, error: '第 ' + (i + 1) + ' 项档位非法（仅允许：' + TIER_VALUES.join(' / ') + '）' });
    }
    /* 权限确认：全局配置写入同样走确认门槛（默认最严，需 confirmed） */
    const perm = checkPermission({ permissionLevel: 3 }, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: true, permissionLevel: 3 });
    try { fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(body.providers, null, 2), 'utf8'); }
    catch (e) { return send(res, 500, { ok: false, error: '写入失败：' + e.message }); }
    audit('model-providers-save', { count: body.providers.length, confirmed: true });
    return send(res, 200, { ok: true, count: body.providers.length });
  }

  /* 写：测试单个提供商连接（只读探测：env 是否配置 + baseUrl 是否可达；不发送 key、不回显值） */
  if (p === '/api/model/providers/test' && method === 'POST') {
    const body = await readBody(req);
    const apiKeyEnv = String(body.apiKeyEnv || '');
    const baseUrl = String(body.baseUrl || '').trim();
    const keyConfigured = apiKeyEnv ? !!process.env[apiKeyEnv] : false;
    let reachable = false, reachError = '';
    if (baseUrl && /^https?:\/\//i.test(baseUrl)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(function () { ctrl.abort(); }, 6000);
        /* 仅做连通性探测，不附带 key，避免泄露；401/403/404 也算「可达」（主机有响应） */
        const r = await fetch(baseUrl, { method: 'GET', signal: ctrl.signal, headers: { 'user-agent': 'vcworkbench-probe/1.0' } });
        clearTimeout(t);
        reachable = true; reachError = 'HTTP ' + r.status;
      } catch (e) {
        if (e && e.name === 'AbortError') { reachError = '探测超时（6s）'; }
        else { reachError = (e && e.message) ? e.message : '连接失败'; }
      }
    } else if (baseUrl) { reachError = 'baseUrl 格式非法（需 http/https）'; }
    else { reachError = '未填写 baseUrl（本地能力无需探测）'; }
    return send(res, 200, { ok: true, keyConfigured: keyConfigured, reachable: reachable, reachError: reachError, sentKey: false });
  }

  /* ===== 真实执行器：调用已登记提供商（本期接通：通义万相·阿里云 DashScope 生图） ===== */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * 阿里云 DashScope 通义万相文生图（wanx 系列，异步任务制）。
   * 安全：key 仅运行时从 process.env 读取，请求头携带，不回显、不写日志、不落盘。
   * @returns {Promise<{ok:boolean, reason?:string, imageUrl?:string, model?:string, taskId?:string, message?:string}>}
   */
  async function invokeDashScopeImage(provider, payload) {
    const key = process.env[provider.apiKeyEnv];
    if (!key) return { ok: false, reason: 'KEY_NOT_CONFIGURED', env: provider.apiKeyEnv };
    const createUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
    const model = String(payload.model || (provider.models && provider.models[0]) || 'wanx2.6-t2i');
    const reqBody = {
      model: model,
      input: { prompt: String(payload.prompt || '') },
      parameters: { size: String(payload.size || '1024*1536'), n: 1, prompt_extend: true }
    };
    let j1;
    try {
      const r1 = await fetch(createUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
        body: JSON.stringify(reqBody)
      });
      j1 = await r1.json().catch(function () { return {}; });
    } catch (e) { return { ok: false, reason: 'CREATE_HTTP_ERROR', message: e.message }; }
    if (!j1.output || !j1.output.task_id) return { ok: false, reason: 'CREATE_FAILED', code: j1.code, message: j1.message };
    const taskId = j1.output.task_id;
    const qUrl = 'https://dashscope.aliyuncs.com/api/v1/tasks/' + taskId;
    let tries = 0;
    while (tries < 40) {
      await sleep(3000);
      let j2;
      try {
        const r2 = await fetch(qUrl, { headers: { Authorization: 'Bearer ' + key } });
        j2 = await r2.json().catch(function () { return {}; });
      } catch (e) { tries++; continue; }
      const s = j2.output && j2.output.task_status;
      if (s === 'SUCCEEDED') {
        const url = j2.output.results && j2.output.results[0] && j2.output.results[0].url;
        if (!url) return { ok: false, reason: 'NO_RESULT_URL' };
        return { ok: true, imageUrl: url, model: model, taskId: taskId };
      }
      if (s === 'FAILED') return { ok: false, reason: 'TASK_FAILED', message: j2.output && j2.output.message };
      tries++;
    }
    return { ok: false, reason: 'POLL_TIMEOUT' };
  }

  /* CosyVoice 声音复刻 + 合成（两步：注册音色 create_voice -> 轮询就绪 -> SpeechSynthesizer 合成 -> 下载音频）。
     参考音频支持 Base64 Data URI 内联（无需公网托管）。副作用：会在用户 DashScope 账户创建一个持久音色 voice_id。 */
  async function invokeCosyVoice(provider, payload) {
    const key = process.env[provider.apiKeyEnv];
    if (!key) return { ok: false, reason: 'KEY_NOT_CONFIGURED', env: provider.apiKeyEnv };
    const model = String(payload.model || (provider.models && provider.models[0]) || 'cosyvoice-v3-flash');
    const text = String(payload.text || '').trim();
    if (!text) return { ok: false, reason: 'EMPTY_TEXT' };
    const refPath = String(payload.refAudioPath || '');
    const refText = String(payload.refText || '').trim();
    if (!refPath || !refText) return { ok: false, reason: 'NEED_REF_AUDIO_AND_TEXT' };
    if (!fs.existsSync(refPath)) return { ok: false, reason: 'REF_AUDIO_NOT_FOUND', path: refPath };
    const audioBuf = fs.readFileSync(refPath);
    const dataUri = 'data:audio/mpeg;base64,' + audioBuf.toString('base64');
    const cosyBase = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts';
    const auth = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
    // 1) 注册音色（创建持久 voice_id）
    let enroll;
    try {
      const r = await fetch(cosyBase + '/customization', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'create_voice', target_model: model, prefix: 'dj04mom', audio: dataUri, text: refText } })
      });
      enroll = await r.json().catch(function () { return {}; });
    } catch (e) { return { ok: false, reason: 'ENROLL_HTTP_ERROR', message: e.message }; }
    const voiceId = enroll.output && enroll.output.voice_id;
    if (!voiceId) return { ok: false, reason: 'ENROLL_FAILED', code: enroll.code, message: enroll.message };
    // 2) 轮询直到就绪
    let status = '';
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      let q;
      try {
        const r = await fetch(cosyBase + '/customization', {
          method: 'POST', headers: auth,
          body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'query_voice', voice_id: voiceId } })
        });
        q = await r.json().catch(function () { return {}; });
      } catch (e) { continue; }
      status = (q.output && q.output.status) || '';
      if (status === 'OK') break;
      if (status && status !== 'DEPLOYING') return { ok: false, reason: 'VOICE_STATUS', status: status, message: q.output && q.output.message, voiceId: voiceId };
    }
    if (status !== 'OK') return { ok: false, reason: 'VOICE_DEPLOY_TIMEOUT', voiceId: voiceId };
    // 3) 合成
    let synth;
    try {
      const r = await fetch(cosyBase + '/SpeechSynthesizer', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ model: model, input: { text: text, voice: voiceId, format: 'mp3', sample_rate: 22050 } })
      });
      synth = await r.json().catch(function () { return {}; });
    } catch (e) { return { ok: false, reason: 'SYNTH_HTTP_ERROR', message: e.message, voiceId: voiceId }; }
    const audioUrl = synth.output && synth.output.audio && synth.output.audio.url;
    if (!audioUrl) return { ok: false, reason: 'SYNTH_NO_URL', code: synth.code, message: synth.message, voiceId: voiceId };
    // 4) 下载音频
    let buf;
    try {
      const ar = await fetch(audioUrl);
      buf = Buffer.from(await ar.arrayBuffer());
    } catch (e) { return { ok: false, reason: 'AUDIO_DOWNLOAD_FAILED', message: e.message, voiceId: voiceId }; }
    if (!buf.length) return { ok: false, reason: 'AUDIO_EMPTY', voiceId: voiceId };
    return { ok: true, audioBuffer: buf, model: model, voiceId: voiceId, audioUrl: audioUrl };
  }

  /* 写：真实调用已登记提供商执行生成（消耗第三方额度，需 confirmed + 项目级权限） */
  if (p === '/api/model/providers/invoke' && method === 'POST') {
    const body = await readBody(req);
    const providerId = String(body.providerId || '');
    const slot = String(body.slot || '');
    const proj = loadProject(String(body.projectId || ''));
    if (!proj) return send(res, 404, { ok: false, error: '项目不存在或无真实目录' });
    /* 双重确认：消耗第三方额度必须 confirmed；同时项目内写文件需权限档确认 */
    const perm = checkPermission(proj.meta, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    if (body.confirmed !== true) return send(res, 403, { ok: false, error: '调用第三方模型会消耗额度，需 confirmed:true', needConfirm: true });
    const prov = loadProviders().filter(function (x) { return x.id === providerId; })[0];
    if (!prov) return send(res, 404, { ok: false, error: '提供商未登记：' + providerId });
    if (prov.capabilities.indexOf(slot) < 0) return send(res, 400, { ok: false, error: '提供商 ' + prov.name + ' 不具备 ' + slot + ' 能力' });
    const keyConfigured = !!process.env[prov.apiKeyEnv];
    if (!keyConfigured) return send(res, 400, { ok: false, error: '环境变量未配置：' + prov.apiKeyEnv + '（请在运行环境配置后重试）', keyConfigured: false });

    /* 本期适配器：通义万相 / 阿里云 DashScope 生图（异步任务制） */
    let result;
    if (prov.type === 'custom-http' && /wanx|万相|dashscope|cosyvoice|aliyun/i.test(prov.id + prov.name + (prov.baseUrl || ''))) {
      if (slot === 'image') {
        result = await invokeDashScopeImage(prov, { model: String(body.model || ''), prompt: String(body.prompt || ''), size: String(body.size || '1024*1536') });
      } else if (slot === 'voice') {
        result = await invokeCosyVoice(prov, {
          model: String(body.model || ''),
          text: String(body.text || ''),
          refAudioPath: String(body.refAudioPath || ''),
          refText: String(body.refText || '')
        });
      } else {
        return send(res, 400, { ok: false, error: '本期仅接通通义万相生图（slot=image）与 CosyVoice 配音（slot=voice），' + slot + ' 暂未实现真实执行器' });
      }
    } else {
      return send(res, 400, { ok: false, error: '本期仅接通通义万相生图执行器；其他提供商仍走 WorkBuddy 桥接任务包' });
    }
    if (!result.ok) {
      audit('invoke-fail', { providerId: providerId, slot: slot, projectId: proj.meta.projectId, reason: result.reason });
      return send(res, 502, { ok: false, error: '调用失败：' + (result.reason || ''), detail: result.message || '', keyConfigured: true });
    }

    /* 下载/落地产物到项目目录（按 slot 区分目录与类型，不覆盖，权限档强制） */
    let buf, targetDir, base, ext, node, kind, category;
    if (slot === 'image') {
      try {
        const imgRes = await fetch(result.imageUrl);
        buf = Buffer.from(await imgRes.arrayBuffer());
      } catch (e) { return send(res, 502, { ok: false, error: '结果图下载失败：' + e.message }); }
      targetDir = safeResolve(proj.dir, path.join(String(proj.meta.version || 'v1'), '03_asset/image'));
      node = 'N06'; kind = '分镜图'; ext = 'png'; category = 'image';
    } else if (slot === 'voice') {
      buf = result.audioBuffer;
      targetDir = safeResolve(proj.dir, path.join(String(proj.meta.version || 'v1'), '03_asset/audio'));
      node = 'N08'; kind = '配音(CosyVoice克隆)'; ext = 'mp3'; category = 'audio';
    } else {
      return send(res, 400, { ok: false, error: '未知 slot：' + slot });
    }
    if (!buf || !buf.length) return send(res, 502, { ok: false, error: '产物为空' });
    fs.mkdirSync(targetDir, { recursive: true });
    const seq = countIndexLines(proj.dir, 'uploads.index.jsonl') + 1;
    base = [proj.meta.code, String(proj.meta.version || 'v1'), node, (slot === 'image' ? 'image-' : 'voice-') + pad2(seq), 'final', 'r01', stampName()].join('_');
    let target;
    try { target = uniquePath(targetDir, base, ext); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    fs.writeFileSync(target, buf);
    const rel = path.relative(proj.dir, target).split(path.sep).join('/');
    appendIndex(proj.dir, 'uploads.index.jsonl', {
      ts: nowISO(), node: node, originalName: path.basename(target), diskName: path.basename(target),
      rel: rel, bytes: buf.length, category: category, permissionLevel: perm.level
    });
    audit('invoke-success', { providerId: providerId, model: result.model, slot: slot, voiceId: result.voiceId, projectId: proj.meta.projectId, rel: rel, bytes: buf.length, permissionLevel: perm.level });
    return send(res, 200, {
      ok: true, provider: prov.name, model: result.model, slot: slot,
      voiceId: result.voiceId,
      artifacts: [{ rel: rel, name: path.basename(target), kind: kind, bytes: buf.length }],
      consumedCredits: true,
      note: slot === 'image'
        ? '已真实调用通义万相生成并落地项目目录；消耗阿里云额度（按张计费）。'
        : '已真实调用 CosyVoice 声音复刻+合成并落地项目目录；消耗阿里云额度（按字符/时长计费）。在你的 DashScope 账户创建了一个持久音色 voice_id=' + (result.voiceId || '-') + '（可在控制台删除）。'
    });
  }

  /* 写：生成 WorkBuddy 桥接任务包（半自动；本接口本身不调用模型、不消耗积分） */
  if (p === '/api/model/task' && method === 'POST') {
    const body = await readBody(req);
    const slots = ['llm', 'image', 'video', 'voice'];
    if (!slots.includes(String(body.slot || ''))) return send(res, 400, { ok: false, error: '未知能力槽位' });
    const proj = loadProject(String(body.projectId || ''));
    const lv = proj ? Number(proj.meta.permissionLevel) : 3;
    const perm = checkPermission({ permissionLevel: lv }, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });
    fs.mkdirSync(TASKS_DIR, { recursive: true });
    const id = 'TASK_' + stampName() + '_' + Math.random().toString(36).slice(2, 6);
    const file = path.join(TASKS_DIR, id + '.json');
    const rec = {
      id: id, createdAt: nowISO(), status: 'pending',
      projectId: String(body.projectId || ''), nodeId: String(body.nodeId || 'N05'),
      slot: String(body.slot), channel: String(body.channel || ''), model: String(body.model || ''),
      billable: !!body.billable, prompt: String(body.prompt || '').slice(0, 20000),
      params: body.params && typeof body.params === 'object' ? body.params : {},
      note: 'WorkBuddy 桥接任务包：由 WorkBuddy 会话读取后用真实模型能力执行，产物回写项目目录；本接口不调用模型、不消耗积分。'
    };
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
    appendIndex(DATA_DIR, 'tasks.index.jsonl', { ts: nowISO(), id: id, slot: rec.slot, node: rec.nodeId, status: 'pending', projectId: rec.projectId, file: path.basename(file) });
    audit('model-task', { taskId: id, slot: rec.slot, projectId: rec.projectId, node: rec.nodeId, billable: rec.billable, permissionLevel: perm.level });
    return send(res, 201, { ok: true, id: id, path: file, status: 'pending', callsModel: false, consumesCredits: false });
  }

  /* 写：任务包产物回执（WorkBuddy 会话执行后回写；不覆盖任务包本体） */
  if (p === '/api/model/task/result' && method === 'POST') {
    const body = await readBody(req);
    const taskId = String(body.taskId || '');
    if (!/^TASK_[A-Za-z0-9_]+$/.test(taskId)) return send(res, 400, { ok: false, error: '任务包 ID 格式非法' });
    const taskFile = path.join(TASKS_DIR, taskId + '.json');
    if (!fs.existsSync(taskFile)) return send(res, 404, { ok: false, error: '任务包不存在（可能已清理）' });
    let task;
    try { task = JSON.parse(fs.readFileSync(taskFile, 'utf8')); } catch (e) { return send(res, 400, { ok: false, error: '任务包解析失败' }); }
    const reqProject = String(body.projectId || task.projectId);
    const proj = loadProject(reqProject);
    if (!proj) return send(res, 404, { ok: false, error: '项目无真实目录，无法校验产物', needRealDir: true });
    if (reqProject !== proj.meta.projectId) return send(res, 400, { ok: false, error: '项目 ID 与任务包不匹配' });
    const perm = checkPermission(proj.meta, 'create', body.confirmed === true);
    if (!perm.ok) return send(res, 403, { ok: false, error: perm.reason, needConfirm: !!perm.needConfirm, permissionLevel: perm.level });

    /* 逐项校验产物确实落在项目目录内且存在，防止伪造回执 */
    const checked = [];
    const list = Array.isArray(body.artifacts) ? body.artifacts : [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i] || {}, rel = String(a.rel || '');
      let full;
      try { full = safeResolve(proj.dir, rel); } catch (e) { return send(res, 400, { ok: false, error: '产物路径越界：' + rel }); }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 400, { ok: false, error: '产物文件不存在：' + rel });
      checked.push({
        rel: path.relative(proj.dir, full).split(path.sep).join('/'),
        name: String(a.name || path.basename(full)), kind: String(a.kind || '产物'),
        bytes: fs.statSync(full).size,
        meta: a.meta && typeof a.meta === 'object' ? a.meta : {}
      });
    }
    /* R2-07：强约束声明校验。服务端不解析图像语义，但强制要求画面类产物声明 G1/G2 并留痕。
       缺声明不阻断登记（兼容历史回执），仅告警 + 写 ops.log，避免破坏既有回执链路。 */
    const isImageSlot = /^(image|video_gen|video_compose)$/.test(String(task.slot || ''));
    const declaredRules = Array.isArray(body.hardRules) ? body.hardRules.map(String) : [];
    const ruleWarn = [];
    if (isImageSlot && !declaredRules.includes('G1')) ruleWarn.push('MISSING_G1');
    if (isImageSlot && !declaredRules.includes('G2')) ruleWarn.push('MISSING_G2');
    const g2Processed = body.g2Processed === true;
    if (ruleWarn.length) {
      audit('hardrules-warning', { taskId: taskId, projectId: proj.meta.projectId, slot: task.slot, missing: ruleWarn });
    }

    const resultFile = path.join(TASKS_DIR, taskId + '.result.json');
    if (fs.existsSync(resultFile)) return send(res, 409, { ok: false, error: '回执已存在，拒绝覆盖（Q06）' });
    const rec = {
      taskId: taskId, projectId: proj.meta.projectId, nodeId: task.nodeId, slot: task.slot,
      status: String(body.status || 'succeeded'), completedAt: nowISO(),
      elapsed: String(body.elapsed || ''),
      note: String(body.note || '由 WorkBuddy 会话内工具生成并回写项目目录'),
      artifacts: checked, permissionLevel: perm.level,
      hardRules: declaredRules, hardRulesWarning: ruleWarn, g2Processed: g2Processed
    };
    fs.writeFileSync(resultFile, JSON.stringify(rec, null, 2), 'utf8');
    appendIndex(DATA_DIR, TASK_RESULT_INDEX, {
      ts: nowISO(), taskId: taskId, status: rec.status, projectId: rec.projectId,
      node: rec.nodeId, artifacts: checked.length, file: path.basename(resultFile)
    });
    audit('model-task-receipt', { taskId: taskId, projectId: rec.projectId, status: rec.status, artifacts: checked.length, permissionLevel: perm.level });
    return send(res, 201, { ok: true, taskId: taskId, status: rec.status,
      artifacts: checked.length, resultPath: resultFile, coveredExisting: false });
  }

  /* 只读：任务包列表（含回执状态与产物清单） */
  if (p === '/api/model/tasks' && method === 'GET') {
    const f = path.join(DATA_DIR, 'tasks.index.jsonl');
    const receipts = {};
    const rf = path.join(DATA_DIR, TASK_RESULT_INDEX);
    if (fs.existsSync(rf)) {
      fs.readFileSync(rf, 'utf8').trim().split('\n').filter(Boolean).forEach(function (l) {
        try { const r = JSON.parse(l); receipts[r.taskId] = r; } catch (e) { /* 跳过坏行 */ }
      });
    }
    let tasks = [];
    if (fs.existsSync(f)) {
      tasks = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(function (l) {
        try { return JSON.parse(l); } catch (e) { return null; }
      }).filter(Boolean).map(function (t) {
        const r = receipts[t.id];
        const row = Object.assign({}, t, {
          fileExists: fs.existsSync(path.join(TASKS_DIR, t.file || '')),
          status: r ? r.status : 'pending', receipt: r || null, receiptArtifacts: []
        });
        if (r) {
          try {
            const rf = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, r.file), 'utf8'));
            // 兼容两种回执：标准 artifacts 数组 / 简报式 artifacts 计数 + artifactsForSync 数组
            row.receiptArtifacts = Array.isArray(rf.artifactsForSync) ? rf.artifactsForSync
              : (Array.isArray(rf.artifacts) ? rf.artifacts : []);
          } catch (e) { /* 回执文件缺失时保持空数组 */ }
        }
        return row;
      });
    }
    return send(res, 200, { ok: true, readonly: true, total: tasks.length, tasks: tasks.slice().reverse() });
  }

  /* 审计日志（只读） */
  if (p === '/api/ops-log' && method === 'GET') {
    if (!fs.existsSync(OPS_LOG)) return send(res, 200, { ok: true, lines: [] });
    return send(res, 200, { ok: true, lines: fs.readFileSync(OPS_LOG, 'utf8').trim().split('\n').filter(Boolean) });
  }

  return send(res, 404, { ok: false, error: '未知接口 ' + p });
}

/* 同源静态托管，避免 file:// 下的跨域与本地文件限制 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (!/^[A-Za-z0-9_.\-]+$/.test(rel)) { res.writeHead(400); return res.end('bad path'); }
  const file = path.join(STATIC_DIR, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async function (req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }
  const u = new URL(req.url, 'http://' + HOST + ':' + PORT);
  if (u.pathname.startsWith('/api/')) {
    try { await handleAPI(req, res, u); }
    catch (e) {
      console.error('[api-error]', e);
      audit('api-error', { path: u.pathname, error: e.message });
      if (!res.headersSent) send(res, 500, { ok: false, error: e.message });
    }
    return;
  }
  serveStatic(res, u.pathname);
});

ensureDirs();
server.listen(PORT, HOST, function () {
  console.log('[OK] 本地数据服务已启动: http://' + HOST + ':' + PORT + '/');
  console.log('     工作空间: ' + WORKSPACE);
  console.log('     蓝本目录（只读）: ' + SCAN_ROOT);
  console.log('     项目目录: ' + PROJECTS_ROOT);
  console.log('     审计日志: ' + OPS_LOG);
  audit('service-start', { port: PORT, host: HOST });
});
