/**
 * N12 交付包归档（本地文件操作，零积分）：按 §6.2/§6.3 生成交付清单与任务包 JSON。
 *
 * 只生成索引与清单，不复制/移动/删除任何既有产物（Q06 不覆盖、不删数据）。
 * 依赖：Node 内置 fs/path
 * 运行：node scripts/n12_archive_DJ04.js
 * 输出：v1/06_build/DJ04_v1_N12_delivery-manifest_final_r01_<stamp>.json
 *       data/tasks/TASK_<stamp>_n12.json
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ = path.join(W, 'projects/P_20261110_004_DJ04');
const BUILD = path.join(PROJ, 'v1/06_build');
const STAMP = '20261111014000';

/** 递归列出项目 v1 下所有文件（相对路径，全相对，§6.3） */
function listRel(root, base, out) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) listRel(full, rel, out);
    else if (e.isFile()) out.push({ rel, bytes: fs.statSync(full).size });
  }
}

/** 主流程：生成交付清单 + 任务包 JSON + 变更记录追加 */
function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  const v1 = path.join(PROJ, 'v1');
  const files = [];
  listRel(v1, 'v1', files);

  const deliverables = files.filter(f =>
    /final_r02_/.test(f.rel) || /qc-report/.test(f.rel) || /compose-params_final_r02/.test(f.rel));
  const manifest = {
    deliveryId: `DELIVERY_DJ04_N12_${STAMP}`,
    projectId: 'P_20261110_004', code: 'DJ04', nodeId: 'N12',
    at: new Date().toISOString(), tool: '本地 Node 文件索引（零积分）',
    policy: '只生成清单，不复制/移动/删除既有产物；路径全相对；新版本不覆盖旧版（Q06）',
    master: 'v1/04_output/master/DJ04_v1_N10_master_final_r02_20261111012500.mp4',
    masterBytes: fs.statSync(path.join(PROJ, 'v1/04_output/master/DJ04_v1_N10_master_final_r02_20261111012500.mp4')).size,
    totalFilesInV1: files.length,
    deliverableCount: deliverables.length,
    deliverables: deliverables.map(f => ({ rel: f.rel, bytes: f.bytes })),
    changelogPath: 'changelog.jsonl',
    assetsIndexPath: 'assets.index.json',
    qcReport: 'v1/04_output/qc/DJ04_v1_N11_qc-report_final_r01_20261111013500.json',
    unverified: [
      '真实浏览器肉眼播放验证未做',
      'C04 墙面表格纸纹理 / 妈妈未出画待人工复核',
      '音素级口型同步以 D 批 A/B 验证结论为准'
    ]
  };
  const mf = path.join(BUILD, `DJ04_v1_N12_delivery-manifest_final_r01_${STAMP}.json`);
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2), 'utf8');

  // 任务包 JSON（供工作台桥接链路识别）
  const task = {
    id: `TASK_${STAMP}_n12`, createdAt: new Date().toISOString(), status: 'succeeded',
    projectId: 'P_20261110_004', nodeId: 'N12', slot: 'archive',
    channel: '本地文件索引（零积分）', model: '无（本地 fs）', billable: false,
    params: { deliverableCount: deliverables.length, totalFilesInV1: files.length },
    note: 'N12 归档只生成清单与任务包，不改动既有产物；本接口不调用模型、不消耗积分。'
  };
  const tf = path.join(W, 'data/tasks', `TASK_${STAMP}_n12.json`);
  fs.writeFileSync(tf, JSON.stringify(task, null, 2), 'utf8');
  console.log(`[OK] v1 files=${files.length} deliverables=${deliverables.length}`);
  console.log('[OK] ' + mf);
  console.log('[OK] ' + tf);
}

try { main(); } catch (e) { console.error('[FATAL]', e && e.stack || e); process.exitCode = 1; }
