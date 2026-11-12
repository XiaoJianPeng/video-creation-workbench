/**
 * 真实任务包执行样板：WorkBuddy 会话内文本能力 → 产物落盘 → 任务包回执
 *
 * 项目：P_20261110_004 / DJ04《初三上学期期中考试考前考后重点该关注什么》
 * 用法：node run-task-DJ04.js
 * 说明：
 *  - 会话内 LLM 已产出 6 个真实文件，本脚本只校验并登记，不代生成、不调模型、不消耗积分
 *  - 每次运行会新建一个任务包 ID 与新回执（不覆盖既有文件，Q06）
 *  - 权限档 1（全部权限）；线上业务数据零接入零写入
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://127.0.0.1:8791';
const W = 'D:/WorkBuddy_space/WorkBuddy全流程短视频创作空间';
const PROJ_DIR = path.join(W, 'projects', 'P_20261110_004_DJ04');
const PROJECT_ID = 'P_20261110_004';
const STAMP = '20261110205600';

const ARTIFACTS = [
  { rel: 'v1/01_input/spec/DJ04_v1_N02_spec-01_final_r01_' + STAMP + '.json',
    name: '输入快照_N02.json', kind: '输入快照', meta: { node: 'N02', role: '输入依据' } },
  { rel: 'v1/02_prompt/script/DJ04_v1_N02_script-01_final_r01_' + STAMP + '.md',
    name: '考前考后重点_内容要点.md', kind: '内容要点', meta: { node: 'N02', role: '脚本素材' } },
  { rel: 'v1/02_prompt/script/DJ04_v1_N02_script-02_final_r01_' + STAMP + '.md',
    name: '初三第一次期中考_4镜短剧脚本.md', kind: '短剧脚本', meta: { node: 'N02', shots: 4, durationSec: 30 } },
  { rel: 'v1/04_output/storyboard/DJ04_v1_N02_storyboard-01_final_r01_' + STAMP + '.json',
    name: '分镜表_4镜.json', kind: '分镜表', meta: { node: 'N02', format: '9:16 / 1080x1920 / 30fps' } },
  { rel: 'v1/02_prompt/image/DJ04_v1_N06_prompt-01_final_r01_' + STAMP + '.md',
    name: 'N06生图提示词_4张.md', kind: '生图提示词', meta: { node: 'N06', status: '待生成，未消耗积分' } },
  { rel: 'v1/04_output/subtitle/DJ04_v1_N08_voice-01_final_r01_' + STAMP + '.json',
    name: '配音与字幕清单_9句.json', kind: '配音清单', meta: { node: 'N08', lines: 9, status: '待配音' } }
];

const TASK_PROMPT = [
  '项目：初三上学期期中考试考前考后重点该关注什么（剧情短剧·漫剧）。',
  '要求：用 3–4 个镜头讲一个完整的小反转，第 1 镜建立人物与困境，第 2 镜推进冲突并埋线索，',
  '第 3 镜揭示反转，第 4 镜收束情绪；台词口语化；人物身份与服装全程一致；结尾留一个记忆点。',
  '内核：初三上第一次期中考分数参考价值有限、诊断价值最大；考前重定位不刷量，考后重归因而非排名。',
  '产出：内容要点、4 镜短剧脚本、分镜表、生图提示词（待生成）、配音清单。'
].join('');

async function post(url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
}

(async function main() {
  let pass = 0, fail = 0;
  const ck = (name, ok, extra) => {
    if (ok) { pass++; console.log('[PASS] ' + name + (extra ? ' — ' + extra : '')); }
    else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); }
  };

  /* 1. 校验产物真实存在 */
  const checked = ARTIFACTS.map(function (a) {
    const full = path.join(PROJ_DIR, a.rel);
    const exists = fs.existsSync(full) && fs.statSync(full).isFile();
    return Object.assign({}, a, { bytes: exists ? fs.statSync(full).size : 0, exists: exists });
  });
  ck('6 个产物文件真实存在', checked.every(function (a) { return a.exists; }),
    checked.filter(function (a) { return a.exists; }).length + '/6');
  ck('产物均有实际内容', checked.every(function (a) { return a.bytes > 100; }),
    '合计 ' + checked.reduce(function (s, a) { return s + a.bytes; }, 0) + ' 字节');
  if (fail) { console.log('产物缺失，中止'); process.exit(1); }

  /* 2. 创建桥接任务包 */
  const task = await post('/api/model/task', {
    projectId: PROJECT_ID, nodeId: 'N02', slot: 'llm',
    channel: 'WorkBuddy 会话内文本能力（本地免费）',
    model: '会话内 LLM（无外部 API、无凭据）',
    billable: false, confirmed: true,
    prompt: TASK_PROMPT,
    params: {
      theme: '初三上学期期中考试考前考后重点该关注什么',
      projectType: '剧情短剧·漫剧', shots: 4, durationSec: 30,
      aspectRatio: '9:16', resolution: '1080P', fps: 30,
      artifactCount: 6, note: '本任务由 WorkBuddy 会话内文本能力执行，不消耗积分'
    }
  });
  ck('任务包创建成功', task.status === 201 && task.body.ok, task.body.id || JSON.stringify(task.body));
  ck('接口明确未调模型 / 未耗积分',
    task.body.callsModel === false && task.body.consumesCredits === false);
  const taskId = task.body.id;
  if (!taskId) { console.log('无任务包 ID，中止'); process.exit(1); }
  ck('任务包文件已落盘', fs.existsSync(path.join(W, 'data', 'tasks', taskId + '.json')));

  /* 3. 回执：逐项校验路径后登记 */
  const receipt = await post('/api/model/task/result', {
    taskId: taskId, projectId: PROJECT_ID, status: 'succeeded',
    elapsed: '约 6 分钟（会话内文本生成）',
    note: '由 WorkBuddy 会话内 LLM 产出并回写项目目录；未调用外部模型 API、未消耗积分；生图/生视频未执行',
    artifacts: checked.map(function (a) {
      return { rel: a.rel, name: a.name, kind: a.kind, meta: a.meta };
    }),
    confirmed: true
  });
  ck('回执登记成功', receipt.status === 201 && receipt.body.ok,
    '产物 ' + (receipt.body.artifacts || 0) + ' 个');
  ck('回执不覆盖既有文件', receipt.body.coveredExisting === false);
  ck('回执文件已落盘', fs.existsSync(path.join(W, 'data', 'tasks', taskId + '.result.json')));

  /* 4. 列表接口可读性验证（前端「同步回执」依赖此接口） */
  const list = await (await fetch(BASE + '/api/model/tasks')).json();
  const rec = (list.tasks || []).filter(function (t) { return t.id === taskId; })[0];
  ck('列表可查到该任务', !!rec);
  ck('状态为 succeeded', !!rec && rec.status === 'succeeded', rec && rec.status);
  ck('产物清单透传给前端', !!rec && rec.receiptArtifacts && rec.receiptArtifacts.length === 6,
    rec && rec.receiptArtifacts ? rec.receiptArtifacts.length + ' 个' : '0');
  ck('关联节点 N02 正确', !!rec && rec.node === 'N02', rec && rec.node);
  ck('归属项目 ID 正确', !!rec && rec.projectId === PROJECT_ID, rec && rec.projectId);

  /* 5. 追加式变更记录（append-only，不覆盖） */
  const clPath = path.join(PROJ_DIR, 'changelog.jsonl');
  const old = fs.readFileSync(clPath, 'utf8');
  const maxSeq = old.trim().split('\n').filter(Boolean).reduce(function (m, l) {
    try { return Math.max(m, Number(JSON.parse(l).seq) || 0); } catch (e) { return m; }
  }, 0);
  const row = {
    seq: maxSeq + 1, ts: new Date().toISOString(), action: 'create', node: 'N02',
    summary: 'WorkBuddy 会话内文本能力产出 6 个脚本/分镜/提示词产物，任务包 ' + taskId + ' 回执 succeeded（零积分）',
    actor: 'workbuddy', taskId: taskId, artifacts: 6
  };
  fs.appendFileSync(clPath, JSON.stringify(row) + '\n', 'utf8');
  ck('变更记录追加成功（未覆盖）', fs.readFileSync(clPath, 'utf8').indexOf(old) === 0);

  /* 6. 只读红线复核 */
  const health = await (await fetch(BASE + '/api/health')).json();
  ck('蓝本只读 / 线上零写入', health.readonlyBlueprint === true && health.onlineBusinessData === 'never');

  console.log('\n=== 任务包执行结果 ===');
  console.log('任务包 ID : ' + taskId);
  console.log('项目      : ' + PROJECT_ID + ' / DJ04');
  console.log('产物      : ' + checked.length + ' 个 / ' + checked.reduce(function (s, a) { return s + a.bytes; }, 0) + ' 字节');
  checked.forEach(function (a) { console.log('  - ' + a.rel + ' (' + a.bytes + ' B, ' + a.kind + ')'); });
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  console.log('\n下一步：工作台「模型与协作」→ 刷新状态 → 同步回执到本项目（当前项目需为 P_20261110_004）');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('EXCEPTION ' + e.message); process.exit(1); });
