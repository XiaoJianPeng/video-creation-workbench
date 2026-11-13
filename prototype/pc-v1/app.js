/* 通用视频创作项目管理工作台 · PC v1 原型
 * PC 网页工作台：本地 Node 服务（通道 ②）+ 浏览器 localStorage 演示数据；服务离线时降级为纯本地演示。
 * 边界：执行区为模拟流程 + WorkBuddy 桥接任务包，不直接调用模型、不消耗积分；
 *       文件本体与提示词可真实落盘（§6.2）；线上业务数据零接入、零写入。
 * 规则来源：需求设计文档 v1.1（Q01–Q20 已拍板 + R1/R2/R3 闭环）
 *   - 可枚举字段只提供选择控件，禁止自由文本（Q18）
 *   - 提示词可编辑但另存新版本 + diff + 留痕（Q17）
 *   - 主题 = 预设标签 + 用户可增字典项，仍不开放自由文本（Q07 A / Q09）
 *   - 系统不自动覆盖、不自动删除；手动删除需二次确认 + 审计摘要（Q06 / Q19）
 *   - 免费能力优先，计费能力需用户选择或确认（Q04）
 *   - 固定浅色工作台 + 深色媒体区，不跟随系统（Q16）
 */
(function () {
  'use strict';

  var KEY = 'vcworkbench.pc.v1';
  /* 通过本地服务访问时同源；file:// 打开时回落到绝对地址（服务已允许 CORS） */
  var API_BASE = (location.protocol === 'http:' || location.protocol === 'https:') ? '' : 'http://127.0.0.1:8791';
  var PERMISSION_LEVELS = [
    { v: 1, label: '1 允许全部权限（含删除）', desc: '新增 / 修改 / 删除自动执行，无需逐次确认' },
    { v: 2, label: '2 仅允许读写操作', desc: '可新增与修改，禁止任何删除' },
    { v: 3, label: '3 每次新增 / 修改 / 删除需用户确认', desc: '最严格；每次写操作弹二次确认' }
  ];
  var serviceOnline = false, serviceInfo = null, scanSummary = null, realProjects = null;
  var modelCredentials = null, modelTasks = null;
  /* P1-2：模拟执行的进行态（仅内存，不持久化；刷新后由 normalizeProjects 归位） */
  var runState = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n, w) { return String(n).padStart(w || 2, '0'); };
  var stamp = function () {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes());
  };
  var timeStr = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };
  var uid = function (p) { return p + '_' + Math.random().toString(36).slice(2, 8); };
  /* 按 Unicode 码点计「字数」，中文与 emoji 均按 1 字计 */
  var charLen = function (s) { return Array.from(s || '').length; };
  var descPreview = function (s, n) {
    var a = Array.from(s || '');
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  };

  /* ============ 枚举字典（v1.1 §5.3） ============ */
  var DICT = {
    projectType: ['带货短视频', '剧情短剧·漫剧', '口播科普', '产品宣传片', '图文动效·Vlog', '音乐 MV·混剪'],
    resolution: ['480P', '720P', '1080P', '2K(待核实)', '4K'],
    aspectRatio: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'],
    styleFlat: ['写实摄影 / 电影感', '商业产品写实', '纪实人文', '日系治愈胶片', '3D 动画 / 皮克斯式卡通',
      '日系赛璐璐动漫', '吉卜力水彩', '2D 卡通', '粘土定格', '水墨国风', '青绿山水', '仙侠写实',
      '赛博朋克', '蒸汽波', '废土末日', '90 年代港风胶片', 'VHS 录像带', '黑白电影'],
    styleAux: ['无', '柔光', '胶片颗粒', '高反差', '低饱和', '暖调', '冷调'],
    fps: ['24', '25', '30', '60'],
    clipSeconds: ['5s', '10s'],
    durationBand: ['≤15s', '15–30s', '30–60s', '1–3min', '3–10min', '>10min'],
    platform: ['抖音', '快手', '微信视频号', '小红书', 'B站', '微博', 'YouTube', '自有渠道'],
    themeGenre: ['带货种草', '剧情反转', '生活日常', '知识科普', '产品测评', '品牌宣传', '情感共鸣', '节日热点', '教程演示', '旅行记录', '音乐舞蹈'],
    themeScene: ['厨房', '客厅', '办公室', '街头', '商场', '户外自然', '摄影棚纯色', '车内', '教室', '虚拟场景'],
    themeSelling: ['省时省力', '健康低脂', '性价比', '颜值设计', '智能便捷', '限时优惠', '品质质感', '情感陪伴'],
    themeMood: ['治愈清新', '欢快活泼', '戏剧张力', '悬疑紧张', '史诗宏大', '宁静舒缓', '幽默诙谐', '高级冷调'],
    audience: ['泛人群', '上班族', '宝妈', '学生', '银发', '小微商家', '极客', '女性向', '男性向'],
    narrative: ['冲突-转折-解决', '问题-方案-证据', '前后对比', '清单罗列', '悬念揭晓', '时间流水'],
    cameraMove: ['缓慢推近', '拉远', '左右摇', '环绕', '固定', '手持轻晃', '跟随', '极慢推镜'],
    transition: ['硬切', '叠化(fade)', '左滑(slideleft)', '右滑', '淡入淡出', '无'],
    subtitlePos: ['底部居中', '底部居中+半透明条', '顶部', '中部', '不烧录'],
    voice: ['zh-CN-XiaoxiaoNeural（晓晓）', 'zh-CN-YunxiNeural（云希）', 'zh-CN-YunjianNeural（云健）', '上传音频（资产库引用）'],
    voiceRate: ['-10%', '0%', '+8%', '+15%', '+25%'],
    voiceLang: ['普通话', '粤语', '英语', '日语'],
    qcItems: ['CRLF 检查', '中文渲染', '抽帧目检', '全片解码', '音轨能量', '转场鬼影', '人物一致性', '水印检查', '编码可预览'],
    qcTimes: ['2/12/24s', '1.5/6.5/11.5/16.0s', '4.80/9.10s(转场)'],
    renderTier: ['样片(480P/Draft)', '标准(720P)', '正式(1080P)', '高清(4K)'],
    concurrency: ['串行(默认)', '低并发(2)', '高并发(≥3，需确认)'],
    timeoutTier: ['短(15s)', '标准(30s)', '长(120s)'],
    watermark: ['不主动添加（默认，Q10）', '保留工具自带水印', '字幕条压暗遮挡', '后期处理(待核实)'],
    license: ['自有', '已授权', '自用 / 待核实', '商用待确认'],
    reworkReason: ['风格不符', '人物不一致', '文字错误', '时长超标', '音画不同步', '编码不兼容', '生成失败', '其他'],
    reasonCode: ['需求变更', '质检不通过', '人物一致性', '中文渲染缺陷', '参数调整', '工具失败', '目录迁移', '版本回滚', '合规要求', '其他'],
    namingTemplate: ['标准模板（项目_版本_节点_分类_序号_状态_修订_时间戳）', '精简模板（省略状态与修订）', '仅序号模板（构建中间物）'],
    versionPolicy: ['成片级迭代新建版本目录', '每次生成都新建版本目录', '仅文件级修订不建版本目录'],
    dictSource: ['市面调研', '蓝本', '行业通识', '用户自定义'],
    descriptionTemplate: ['带货种草·冲突解决', '剧情反转·短剧', '知识科普·口播', '产品宣传·质感',
      '教程演示·步骤', 'Vlog·生活记录', '节日热点·促销', '品牌故事·情绪'],
    assetType: ['图片', '角色', '音色', '字体'],
    assetCategory: ['分镜图', '参考图', '产品图', '角色立绘', '配音音频', '字幕字体', '背景音乐', '其他'],
    /* 模型层只给「通道 + 能力类型」，不编造具体平台模型名；具体型号由 Q09 字典机制自行新增 */
    modelChannel: ['WorkBuddy 桥接（默认）', '自定义 HTTP 接口（需配置 endpoint）', '本地免费能力'],
    modelLlm: ['WorkBuddy LLM（桥接）', '自定义 LLM（需核实接口）'],
    modelImage: ['WorkBuddy 生图（桥接）', '自定义生图（需核实接口）'],
    modelVideo: ['WorkBuddy 视频（桥接）', '自定义视频（需核实接口）'],
    modelVoice: ['本地 TTS（免费）', '自定义 TTS（需核实接口）']
  };
  /* 模型提供商类型（参考 WorkBuddy 模型自定义配置：OpenAI 兼容 / 自定义 HTTP / 本地） */
  var PROVIDER_TYPE_LABEL = {
    'openai-compatible': 'OpenAI 兼容',
    'custom-http': '自定义 HTTP',
    'local': '本地能力'
  };
  var SLOT_KEYS = ['llm', 'image', 'video', 'voice'];
  var SLOT_LABEL = { llm: 'LLM', image: '生图', video: '视频', voice: 'TTS' };
  /* 推荐标签与档位（与后端白名单一致；用于卡片徽章、下拉与弹层） */
  var TAG_VALUES = ['性价比最高', '最便宜', '效果最佳'];
  var TIER_VALUES = ['首选', '备选'];
  var TAG_CLASS = { '性价比最高': 't-perf', '最便宜': 't-cheap', '效果最佳': 't-best' };
  var TIER_CLASS = { '首选': 'tier tier-first', '备选': 'tier tier-alt' };
  var PROVIDER_DEFAULT_MODELS = {
    'openai-compatible': 'gpt-4o-mini, gpt-4o',
    'custom-http': '',
    'local': 'edge-tts-XiaoxiaoNeural'
  };
  /* 当前工作台「模型提供商注册表」（全局；从服务端 data/model-providers.json 加载，离线降级 localStorage） */
  var modelProviders = [];
  var MODEL_SLOTS = [
    { key: 'llm', label: '脚本 / LLM', nodes: 'N02 · N05', dict: 'modelLlm', billable: false },
    { key: 'image', label: '分镜图 / 生图', nodes: 'N06', dict: 'modelImage', billable: true },
    { key: 'video', label: '片段 / 视频', nodes: 'N09', dict: 'modelVideo', billable: true },
    { key: 'voice', label: '配音 / TTS', nodes: 'N08', dict: 'modelVoice', billable: false }
  ];
  /* 创作描述模板：仅作为可编辑的起点，选中后写入 textarea，用户仍可自由修改 */
  var TEMPLATE_TEXT = {
    '带货种草·冲突解决': '目标时长与平台：【待选】。用一个日常痛点开场（人物 + 场景 + 冲突），中段让产品自然出现并给出 2–3 个具体卖点，结尾回到人物状态变化并给出行动引导。要有剧情冲突、角色动作、产品特写和台词，不凑篇幅的废话。',
    '剧情反转·短剧': '用 3–4 个镜头讲一个完整的小反转：第 1 镜建立人物与困境，第 2 镜推进冲突并埋线索，第 3 镜揭示反转，第 4 镜收束情绪。台词口语化，人物身份与服装全程一致，结尾留一个记忆点。',
    '知识科普·口播': '面向【目标人群】，用 1 个真实场景讲清 1 个概念：先说痛点，再拆成 3 步，每步给一个可照抄的例子，结尾给一条可复用模板。口播出镜 + 屏幕演示，避免堆术语。',
    '产品宣传·质感': '纯白极简空间、无影柔光，突出材质纹理与产品细节；缓慢环绕运镜配合 2 个特写，中段展示核心功能，结尾定格品牌标识。画面干净、色彩克制，字幕只保留关键信息。',
    '教程演示·步骤': '按「准备 → 操作 1 → 操作 2 → 结果验收」四段组织，每段屏幕录制配一句口播；关键参数用大字号标注，结尾给出常见问题与检查清单。',
    'Vlog·生活记录': '以第一人称记录一段真实过程：开场交代时间地点，中段保留 2–3 个自然发生的细节，结尾给一句个人感受。手持轻晃、自然光、生活化粗糙质感，不做过度包装。',
    '节日热点·促销': '结合【节日/大促】做一条限时向短片：前 3 秒点出优惠与紧迫感，中段展示主推商品与价格利益点，结尾给明确的时间与行动指令。信息集中、节奏快，字幕大字高对比。',
    '品牌故事·情绪': '用一个具体的人物片段承载品牌主张：开场用细节建立情绪，中段让产品/服务以不打扰的方式出现，结尾用一句克制的话收束。慢节奏、暖光、浅景深，避免硬广口吻。'
  };
  var DICT_LABEL = {
    projectType: '项目类型', resolution: '视频分辨率', aspectRatio: '长宽比', styleFlat: '视觉风格（主）',
    styleAux: '辅助风格', fps: '帧率', clipSeconds: '单片段时长', durationBand: '成片时长档',
    platform: '投放平台', themeGenre: '主题·题材', themeScene: '主题·场景', themeSelling: '主题·卖点',
    themeMood: '主题·情绪', audience: '目标人群', narrative: '叙事结构', cameraMove: '运镜',
    transition: '转场', subtitlePos: '字幕位置', voice: '音色', voiceRate: '语速', voiceLang: '配音语言',
    qcItems: '质检项集', qcTimes: '抽帧时刻', renderTier: '生成档位', concurrency: '并发策略',
    timeoutTier: '超时档', watermark: '水印策略', license: '授权状态', reworkReason: '返工原因码',
    reasonCode: '变更原因码',     namingTemplate: '命名模板', versionPolicy: '版本策略', dictSource: '字典来源',
    descriptionTemplate: '创作描述模板', assetType: '资产类型', assetCategory: '资产分类',
    modelChannel: '模型通道', modelLlm: 'LLM 模型', modelImage: '生图模型',
    modelVideo: '视频模型', modelVoice: 'TTS 模型'
  };
  var PIXEL_MAP = {
    '480P': { '9:16': '480×854', '16:9': '854×480', '1:1': '480×480', '4:3': '640×480', '3:4': '480×640', '21:9': '854×366' },
    '720P': { '9:16': '720×1280', '16:9': '1280×720', '1:1': '720×720', '4:3': '960×720', '3:4': '720×960', '21:9': '1280×549' },
    '1080P': { '9:16': '1080×1920', '16:9': '1920×1080', '1:1': '1080×1080', '4:3': '1440×1080', '3:4': '1080×1440', '21:9': '1920×823' },
    '2K(待核实)': { '9:16': '1440×2560', '16:9': '2560×1440', '1:1': '1440×1440', '4:3': '1920×1440', '3:4': '1440×1920', '21:9': '2560×1097' },
    '4K': { '9:16': '2160×3840', '16:9': '3840×2160', '1:1': '2160×2160', '4:3': '2880×2160', '3:4': '2160×2880', '21:9': '3840×1646' }
  };

  /* 精简合并视图（v1.1 §4.1.1，12→8 主节点；旧 N03/N05/N07/N11/N12 降级为随附子步骤 subSteps） */
  var NODE_DEFS = [
    ['N01', '项目初始化（规格 + 能力盘点）', '人工 + 只读探测', ['N03']],
    ['N02', '大纲 / 分镜脚本（含 G4）', '生成 + 人工确认', []],
    ['N03', '资产准备', '上传 / 引用', []],
    ['N04', '分镜生图与画面质检', '生成（计费）+ 质检绑定', ['N05', 'N07']],
    ['N05', '配音与字幕', '生成 + 人工确认', []],
    ['N06', '图生视频', '生成（计费）', []],
    ['N07', '剪辑合成与成片验收', '生成 + 验收', ['N11']],
    ['N08', '归档交付（人工确认）', '人工确认', ['N12']]
  ];
  var NODE_META = {
    N01: { cls: 'theme', capability: 'text_generation', tool: 'LLM（文本模型）+ 本地只读探测', free: true, billable: false },
    N02: { cls: 'script', capability: 'text_generation', tool: 'LLM（文本模型）', free: true, billable: false },
    N03: { cls: 'image', capability: 'asset_ingest', tool: '本地文件 + 资产库', free: true, billable: false },
    N04: { cls: 'image', capability: 'image_gen', tool: 'ImageGen / 通义万相（多参考图）', free: false, billable: true },
    N05: { cls: 'voice', capability: 'tts', tool: 'CosyVoice 克隆 / Edge TTS', free: true, billable: false },
    N06: { cls: 'clip', capability: 'video_gen', tool: 'VideoGen（串行）', free: false, billable: true },
    N07: { cls: 'master', capability: 'video_compose', tool: '本地 ffmpeg（xfade/drawtext）', free: true, billable: false },
    N08: { cls: 'report', capability: 'archive', tool: '本地文件操作（人工确认）', free: true, billable: false }
  };
  /* ============ 项目强约束（2026-11-10 用户放行，全局生效、不可关闭） ============ */
  /* G1：生图不带文字；G2：生图工具水印擦除后再交付。作用于所有画面生成类节点。 */
  var PROJECT_HARD_RULES = [
    {
      id: 'G1', name: '生图不带文字', scope: 'N04 / N06 及所有画面生成类节点',
      rule: '提示词与画面中禁止出现任何文字、字符、字幕、笔迹、logo、水印。所需文案一律走 N07 后期字幕/标题叠层，不由生图渲染（AI 渲染中文易乱码）。',
      enforce: '提示词模板强制注入；完成判据改为「画面无任何文字」；不再尝试让模型写中文。'
    },
    {
      id: 'G2', name: '水印擦除后交付', scope: '所有生图产物',
      rule: '生图工具自带水印（如「AI生成 WORKBUDDY」）必须在交付前用图像擦除工具去除；擦除结果另存新版本（rev 递增），原始文件保留、不覆盖。',
      enforce: '完成判据新增「工具水印已擦除」；擦除动作写变更记录与任务包回执。'
    },
    {
      id: 'G3', name: '句级说话状态对齐（降级）', scope: 'N04 / N06 画面生成类节点',
      rule: 'D3 A/B 验证结论：当前 VideoGen 无法由音频驱动音素级口型。提示词必须显式写明「谁在说话、何时开口/闭口」，使句级说话状态与台词组匹配；禁止正面口部特写；无法保证口型的近景改用侧脸、过肩、背影或画外音。不宣称音素级 lip-sync。',
      enforce: '写入 N04/N06 提示词模板；完成判据新增「句级说话状态已声明」；验收用说话状态一致率 ≥90%（待人工逐帧标注），不考核音素级偏差。'
    }
  ];
  /* 画面生成类节点：强约束作用域（精简后：N04 分镜生图 / N06 图生视频） */
  var IMAGE_NODE_IDS = { N04: 1, N06: 1 };

  /* P1-4：节点专属说明。内容取自 v1.1 §4.2 状态机与蓝本流程归纳，非平台能力声明 */
  var NODE_BRIEF = {
    N01: {
      goal: '冻结主题与交付规格，并顺带完成本机能力/资源只读盘点（旧 N03 随附）',
      inputs: ['主题标签组合（题材 / 场景 / 卖点 / 情绪 / 人群）', '规格包（分辨率 / 比例 / 风格 / 帧率 / 平台）', '创作描述 ≤1000 字', '（随附）工作目录 / 字体 / 音色 / 参考图清单'],
      outputs: ['主题 ID', '3 个候选标题（单选采纳）', '枚举输入快照', '（随附）能力清单 + 缺失项提示'],
      criteria: ['主题标签已选且未超上限', '规格包无「待核实」项', '标题已采纳', '（随附）探测全程只读、未产生写操作']
    },
    N02: {
      goal: '把创作描述拆成可执行的大纲与分镜清单（含 G4 对话强约束）',
      inputs: ['主题 ID', '创作描述', '成片时长档', '镜头数'],
      outputs: ['项目大纲 outline.md', '分镜脚本', '台词清单（含 inner_state / subtext / action_beat）'],
      criteria: ['镜头数与时长档匹配', '台词齐全且符合 G4', '脚本保留版本号']
    },
    N03: {
      goal: '登记本节点所需素材，按 §6.3 生成统一 ASCII 命名',
      inputs: ['本地文件', '资产库只读引用', '角色参考图'],
      outputs: ['资产元数据', '本节点产物登记', 'ASCII 磁盘名'],
      criteria: ['每条就地可见且可移除', '命名序号连续', '跨项目为只读引用']
    },
    N04: {
      goal: '按分镜生成统一风格画面（计费能力需人工确认），生成后即刻绑定画面质检（旧 N07 随附）',
      inputs: ['分镜脚本', '角色参考图', '风格 / 比例 / 分辨率', '（随附）提示词预览'],
      outputs: ['分镜图', '重绘图', '质检结论'],
      criteria: ['人物一致性已检查', '画面无任何文字（G1 强约束）', '工具水印已擦除（G2 强约束）', '句级说话状态已声明（G3）', '计费动作已确认', '（随附）画面质检逐项有结论']
    },
    N05: {
      goal: '生成台词配音与对齐字幕（CosyVoice 克隆 / Edge TTS）',
      inputs: ['台词清单', '音色 / 语速', '字幕位置'],
      outputs: ['配音音频', '字幕文件', '配音清单.json'],
      criteria: ['时长对齐', 'UTF-8 LF 编码', '音色参数留痕']
    },
    N06: {
      goal: '把静态分镜转成动态片段（计费能力需确认）',
      inputs: ['分镜图', '片段时长', '转场 / 运动参数'],
      outputs: ['片段 mp4', '生成参数记录'],
      criteria: ['串行执行不并发', '输入图无文字无水印（G1/G2）', '句级说话状态已声明（G3）', '失败有降级方案', '计费动作已确认']
    },
    N07: {
      /* 旧 N11 的「中文渲染正常」检查对象是本节点（新 N07）后期字幕层，与 G1「生图画面不带文字」不冲突 */
      goal: '拼接片段、配音与字幕输出成片，并合成后直接验收（旧 N11 随附）',
      inputs: ['片段', '配音', '字幕', '转场', '字体'],
      outputs: ['成片 mp4', '合成参数', '新版本文件', '（随附）验收记录'],
      criteria: ['H.264 / AAC + faststart', '成片时长正确', '新版本不覆盖旧片', '（随附）全片可解码、中文渲染正常']
    },
    N08: {
      goal: '按三层目录归位产物，补齐变更记录与索引（人工确认归档，旧 N12 随附）',
      inputs: ['成片', '全部中间产物', 'changelog'],
      outputs: ['交付包', '目录索引', '任务包 JSON'],
      criteria: ['路径全相对', '命名符合 §6.3', '变更链可反查', '（随附）需人工点选「确认归档」']
    }
  };
  var STATUS_CLASS = {
    '未开始': 's-idle', '待输入': '', '待确认': 's-warn', '执行中': 's-run',
    '已通过': 's-ok', '返工中': 's-err', '失败': 's-err', '已跳过': 's-idle'
  };

  /* ============ 演示数据（含蓝本事实） ============ */
  function seedProjects() {
    function makeNodes(statuses) {
      var o = {};
      NODE_DEFS.forEach(function (d, i) { o[d[0]] = { status: statuses[i] || '未开始', runs: 1, outputs: [] }; });
      return o;
    }
    var p1 = {
      id: 'P_20261109_001', code: 'AF30', name: '《11.11 前夜，厨房大战》', type: '带货短视频',
      status: '进行中', version: 'v4',
      titleMode: 'suggest',
      description: '30 秒手机竖屏的智能空气炸锅带货动画短剧，3–4 个镜头。双 11 前夜，加班到十点回家的女生面对冒烟油锅，转身发现台面上的空气炸锅；要有剧情冲突、角色动作、产品特写和台词，不要凑篇幅的废话。3D 动画电影质感、皮克斯式卡通人物，产品屏幕显示「智能空气炸锅 / 180℃ / 25分钟」。',
      workDir: 'D:\\WorkBuddy_space\\WorkBuddy全流程短视频创作空间\\短剧实测',
      created: '2026-11-09 13:57', updated: '2026-11-09 17:26',
      spec: { resolution: '1080P', aspectRatio: '9:16', styleFlat: '3D 动画 / 皮克斯式卡通', styleAux: '暖调', fps: '24', durationBand: '15–30s', clipSeconds: '5s', platform: ['抖音', '微信视频号'], renderTier: '正式(1080P)', transition: '左滑(slideleft)', subtitlePos: '底部居中+半透明条', voice: 'zh-CN-XiaoxiaoNeural（晓晓）', voiceRate: '+8%', watermark: '保留工具自带水印' },
      theme: { genre: ['带货种草', '剧情反转'], scene: ['厨房'], selling: ['省时省力', '健康低脂'], mood: '戏剧张力', audience: ['上班族'], narrative: '冲突-转折-解决' },
      nodes: makeNodes(['已通过', '已通过', '已通过', '待确认', '已通过', '已通过', '待确认', '未开始']),
      currentNode: 'N04',
      changelog: [
        mkChange('create', 'N00', '创建项目', '需求变更', 'user'),
        mkChange('confirm', 'N01', '主题与规格确认通过：30s / 9:16 / 4 镜 / 3D 皮克斯', '需求变更', 'user'),
        mkChange('create', 'N02', '生成分镜脚本《11.11 前夜，厨房大战》', '需求变更', 'workbuddy'),
        mkChange('create', 'N03', '归档 4 张分镜图（1024×1536）与 font.ttf', '参数调整', 'workbuddy'),
        mkChange('create', 'N05', '生成 4 句配音（16.2s）与 UTF-8 LF 字幕', '参数调整', 'workbuddy'),
        mkChange('create', 'N07', '新增成片 v4 人物统一版（18.208s / 437 帧）', '人物一致性', 'user')
      ],
      callRecords: [
        mkCall('N04', 'image_gen', 'ImageGen / 通义万相（多参考图）', 'succeeded', false),
        mkCall('N06', 'video_gen', 'VideoGen（串行）', 'succeeded', true),
        mkCall('N07', 'video_compose', '本地 ffmpeg', 'succeeded', false)
      ],
      assets: [
        mkAsset('AST_0001', '分镜01（夜晚厨房）', '图片', '分镜图', 'final', '1024×1536', 'P_20261109_001'),
        mkAsset('AST_0002', '分镜02·人物重绘', '图片', '重绘图', 'final', '1024×1536', 'P_20261109_001'),
        mkAsset('AST_0003', '低束长发 / 炭灰西装角色', '角色', '身份参考', 'final', '人物一致性基准', 'P_20261109_001'),
        mkAsset('AST_0004', '晓晓 +8%（voice01）', '音色', '中文女声', 'final', '+8%', 'P_20261109_001'),
        mkAsset('AST_0005', 'simhei 字体副本', '字体', '字幕字体', 'final', '9.29 MB', 'P_20261109_001')
      ],
      promptVersions: {}, config: null
    };
    var p2 = {
      id: 'P_20261109_002', code: 'KC01', name: '《AI 提示词入门 3 讲》', type: '口播科普',
      status: '待确认', version: 'v1',
      titleMode: 'suggest',
      description: '（演示数据）面向 AI 零基础读者的提示词入门系列，共 3 讲；每讲用一个真实场景讲清一条提示词写法，口播出镜 + 屏幕演示，结尾留一个可照抄的模板。',
      workDir: 'D:\\WorkBuddy_space\\WorkBuddy全流程短视频创作空间\\projects\\P_20261109_002_KC01',
      created: '2026-11-09 20:10', updated: '2026-11-09 20:24',
      spec: { resolution: '1080P', aspectRatio: '16:9', styleFlat: '写实摄影 / 电影感', styleAux: '无', fps: '30', durationBand: '1–3min', clipSeconds: '10s', platform: ['B站', '自有渠道'], renderTier: '标准(720P)', transition: '硬切', subtitlePos: '底部居中', voice: 'zh-CN-YunxiNeural（云希）', voiceRate: '0%', watermark: '不主动添加（默认，Q10）' },
      theme: { genre: ['知识科普', '教程演示'], scene: ['办公室'], selling: [], mood: '宁静舒缓', audience: ['泛人群', '小微商家'], narrative: '问题-方案-证据' },
      nodes: makeNodes(['已通过', '待输入', '未开始', '未开始', '未开始', '未开始', '未开始', '未开始']), currentNode: 'N02',
      changelog: [mkChange('create', 'N00', '创建项目（口播科普模板）', '需求变更', 'user'), mkChange('confirm', 'N01', '主题与规格确认通过', '需求变更', 'user')],
      callRecords: [], assets: [], promptVersions: {}, config: null
    };
    var p3 = {
      id: 'P_20261109_003', code: 'PP02', name: '《618 产品宣传片》', type: '产品宣传片',
      status: '已交付', version: 'v2',
      titleMode: 'suggest',
      description: '（演示数据）618 大促产品宣传片：纯白极简空间、无影柔光，突出材质纹理与产品细节，缓慢环绕运镜，结尾定格品牌 logo 与促销信息。',
      workDir: 'D:\\WorkBuddy_space\\WorkBuddy全流程短视频创作空间\\projects\\P_20261109_003_PP02',
      created: '2026-11-08 10:02', updated: '2026-11-09 09:40',
      spec: { resolution: '4K', aspectRatio: '16:9', styleFlat: '商业产品写实', styleAux: '高反差', fps: '30', durationBand: '30–60s', clipSeconds: '5s', platform: ['微博', '自有渠道'], renderTier: '高清(4K)', transition: '淡入淡出', subtitlePos: '顶部', voice: 'zh-CN-YunjianNeural（云健）', voiceRate: '0%', watermark: '不主动添加（默认，Q10）' },
      theme: { genre: ['品牌宣传', '产品测评'], scene: ['摄影棚纯色'], selling: ['品质质感', '智能便捷'], mood: '高级冷调', audience: ['泛人群'], narrative: '前后对比' },
      nodes: makeNodes(Array(8).fill('已通过')), currentNode: 'N08',
      changelog: [mkChange('create', 'N00', '创建项目（产品宣传片模板）', '需求变更', 'user'), mkChange('confirm', 'N08', '归档交付 v2 成片', '需求变更', 'user')],
      callRecords: [mkCall('N07', 'video_compose', '本地 ffmpeg', 'succeeded', false)],
      assets: [mkAsset('AST_0006', '产品白底主视觉', '图片', '产品特写', 'final', '3840×2160', 'P_20261109_003')],
      promptVersions: {}, config: null
    };
    return [p1, p2, p3];
  }
  function mkChange(action, node, summary, reason, actor) {
    return { id: uid('chg'), seq: 0, ts: timeStr(), actor: actor || 'user', action: action, node: node,
      summary: summary, reason: reason, archived: false, audit: false };
  }
  function mkCall(node, cap, tool, status, billable) {
    return { id: uid('call'), ts: timeStr(), node: node, capability: cap, matched: tool, status: status,
      billable: billable, cost: billable ? '估算 50–100 积分（未经核实）' : '免费 / 本地', duration: billable ? '67s' : '12s',
      degraded: status === 'degraded' ? '静态图 + zoompan' : '—' };
  }
  function mkAsset(id, name, type, category, status, meta, project) {
    return { id: id, name: name, diskName: id.toLowerCase() + '_v1_N04_' + (type === '音色' ? 'voice' : 'image') + '-01_final_r01_' + stamp() + (type === '音色' ? '.mp3' : '.png'),
      type: type, category: category, status: status, meta: meta, sourceProject: project,
      license: '自用 / 待核实', aiGenerated: type !== '字体', watermark: type === '字体' ? '无' : '工具自带',
      refs: 1, created: '2026-11-09' };
  }

  var DEFAULT_CONFIG = {
    concurrency: '串行(默认)', timeoutTier: '标准(30s)', retry: 3, allowBillable: false,
    renderTier: '标准(720P)', qcItems: ['CRLF 检查', '中文渲染', '全片解码', '编码可预览'],
    namingTemplate: DICT.namingTemplate[0], versionPolicy: DICT.versionPolicy[0],
    nodeEnabled: NODE_DEFS.reduce(function (a, d) { a[d[0]] = true; return a; }, {}),
    /* 模型协作路由：按能力槽位分别指定通道与模型，全部为选择控件 */
    modelRoute: MODEL_SLOTS.reduce(function (a, s) {
      a[s.key] = { channel: DICT.modelChannel[0], model: DICT[s.dict][0] };
      return a;
    }, {}),
    /* 计费确认：默认每次确认；可在本项目内选择不再提示（需二次确认 + 留痕） */
    billingConfirm: { mode: 'always', acknowledgedAt: null }
  };

  /* ============ 状态 ============ */
  var state = {
    projects: [], currentProjectId: null, view: 'projects', assetTab: '全部',
    changelogFilter: '全部', customDict: {}, dictVersion: '1.0.0', promptDirty: false
  };
  var promptNodeId = null;
  function normalizeProjects() {
    state.projects.forEach(function (p) {
      if (p.description === undefined) p.description = '';
      if (!p.titleMode) p.titleMode = 'suggest';
      /* 未指定权限档的旧数据一律按最严格的档 3 处理 */
      if (!p.permissionLevel) p.permissionLevel = 3;
      /* 计费确认默认最严格：每次确认 */
      if (!p.billingConfirm) p.billingConfirm = { mode: 'always', acknowledgedAt: null };
      if (p.config && !p.config.modelRoute) p.config.modelRoute = JSON.parse(JSON.stringify(DEFAULT_CONFIG.modelRoute));
      if (!p.syncedReceipts) p.syncedReceipts = [];
      /* P1-2：上次模拟执行被刷新 / 中断时，状态不能卡在「执行中」 */
      if (p.nodes) Object.keys(p.nodes).forEach(function (k) {
        if (p.nodes[k].status === '执行中') p.nodes[k].status = '待确认';
      });
    });
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        state.projects = s.projects || [];
        state.currentProjectId = s.currentProjectId || null;
        state.customDict = s.customDict || {};
        state.dictVersion = s.dictVersion || '1.0.0';
        /* 兼容之前保存的本地数据：补齐新增字段，不覆盖用户已有内容 */
        normalizeProjects();
        if (state.projects.length) return;
      }
    } catch (e) { /* file:// 下不可用时降级为内存 */ }
    resetData(false);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({
      projects: state.projects, currentProjectId: state.currentProjectId,
      customDict: state.customDict, dictVersion: state.dictVersion
    })); } catch (e) { /* 内存模式 */ }
  }
  function resetData(notify) {
    state.projects = seedProjects();
    state.currentProjectId = state.projects[0].id;
    state.customDict = {};
    state.dictVersion = '1.0.0';
    state.projects.forEach(function (p) { p.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); });
    normalizeProjects();
    renumberChanges();
    save();
    if (notify) toast('演示数据已重置', 'ok');
  }
  function renumberChanges() {
    state.projects.forEach(function (p) {
      p.changelog.slice().reverse().forEach(function (c, i) { c.seq = i + 1; });
    });
  }
  function P() {
    return state.projects.filter(function (p) { return p.id === state.currentProjectId; })[0] || state.projects[0];
  }
  function CFG() { if (!P().config) P().config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); return P().config; }
  function dict(key) { return DICT[key].concat(state.customDict[key] || []); }
  function pixel(p) { return (PIXEL_MAP[p.spec.resolution] || {})[p.spec.aspectRatio] || '联动计算'; }

  /* ============ 通用 UI ============ */
  /* ---------- 本地 Node 服务通道（数据接入 ②） ---------- */
  function api(method, url, body) {
    return fetch(API_BASE + url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }
  /* P0-9：侧栏连接状态与实际一致，不再写「不接后端」 */
  function updateServiceBadge() {
    var dot = $('#svcDot'), label = $('#svcLabel');
    if (!dot || !label) return;
    dot.style.background = serviceOnline ? 'var(--ok)' : 'var(--err)';
    label.textContent = serviceOnline ? '本地数据服务 · 已连接' : '服务未连接 · 仅本地演示数据';
  }
  function checkService() {
    return api('GET', '/api/health').then(function (r) {
      serviceOnline = r.status === 200;
      serviceInfo = serviceOnline ? r.body : null;
      updateServiceBadge();
      return serviceOnline;
    }).catch(function () {
      serviceOnline = false; serviceInfo = null; updateServiceBadge(); return false;
    });
  }
  function loadScanSummary() {
    if (!serviceOnline) return Promise.resolve(null);
    return api('GET', '/api/scan-index').then(function (r) {
      scanSummary = r.status === 200 ? r.body : null;
      return scanSummary;
    }).catch(function () { scanSummary = null; return null; });
  }
  /* 真实项目列表在启动时预取并缓存，设置页同步渲染，避免每次进入都发请求 */
  /**
   * R2-06：把服务端真实项目并入前端项目列表（仅追加缺失项，不覆盖既有演示数据）。
   * 目的：让「模型与协作」的回执同步按钮、输出区真实产物可归属到正确项目。
   * 说明：只改浏览器演示态，不创建/修改真实目录，不调用 syncProjectToServer。
   * @param {Array} list /api/projects 返回的项目元数据
   */
  function mergeRealProjects(list) {
    if (!Array.isArray(list) || !list.length) return 0;
    var known = {};
    state.projects.forEach(function (p) { known[p.id] = true; });
    var added = 0;
    list.forEach(function (m) {
      if (!m || !m.id || known[m.id]) return;
      var nodes = {};
      NODE_DEFS.forEach(function (d, i) { nodes[d[0]] = { status: i === 0 ? '待输入' : '未开始', runs: 1, outputs: [] }; });
      state.projects.push({
        id: m.id, code: m.code, name: m.name, type: '剧情短剧·漫剧',
        status: m.status || '进行中', version: m.version || 'v1',
        titleMode: 'custom', description: '', permissionLevel: Number(m.permissionLevel) || 3,
        workDir: 'D:\\WorkBuddy_space\\WorkBuddy全流程短视频创作空间\\projects\\' + m.dir,
        created: m.updatedAt || timeStr(), updated: m.updatedAt || timeStr(),
        spec: { resolution: '1080P', aspectRatio: '9:16', styleFlat: '写实摄影 / 电影感', styleAux: '无',
          fps: '30', durationBand: '15–30s', clipSeconds: '5s', platform: ['抖音'],
          renderTier: '正式(1080P)', transition: '硬切', subtitlePos: '底部居中',
          voice: DICT.voice[0], voiceRate: '+0%', watermark: '不主动添加（默认，Q10）' },
        theme: { genre: [], scene: [], selling: [], mood: '温和', audience: [], narrative: '冲突-转折-解决' },
        nodes: nodes, currentNode: 'N01', changelog: [], callRecords: [], assets: [],
        promptVersions: {}, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
        syncedReceipts: [], realDir: m.dir, fromServer: true
      });
      known[m.id] = true;
      added++;
    });
    if (added) save();
    return added;
  }

  function loadRealProjects() {
    if (!serviceOnline) { realProjects = []; return Promise.resolve(realProjects); }
    return api('GET', '/api/projects').then(function (r) {
      realProjects = r.status === 200 ? r.body.projects : [];
      mergeRealProjects(realProjects);
      return realProjects;
    }).catch(function () { realProjects = []; return realProjects; });
  }
  /* 模型凭据状态与任务包在启动时预取并缓存，页面同步渲染 */
  function loadModelState() {
    if (!serviceOnline) { modelCredentials = null; modelTasks = null; return Promise.resolve(); }
    return Promise.all([
      api('GET', '/api/model/credentials').then(function (r) { modelCredentials = r.status === 200 ? r.body : null; }).catch(function () { modelCredentials = null; }),
      api('GET', '/api/model/tasks').then(function (r) { modelTasks = r.status === 200 ? r.body : null; }).catch(function () { modelTasks = null; }),
      api('GET', '/api/model/providers').then(function (r) {
        if (r.status === 200 && Array.isArray(r.body.providers)) {
          modelProviders = r.body.providers;
          /* 服务端为准，回写 localStorage 做离线降级副本 */
          try { localStorage.setItem('vcworkbench.providers', JSON.stringify(modelProviders)); } catch (e) {}
        }
      }).catch(function () {
        /* 离线降级：读 localStorage 副本 */
        try { var c = JSON.parse(localStorage.getItem('vcworkbench.providers') || '[]'); if (Array.isArray(c)) modelProviders = c; } catch (e) {}
      })
    ]);
  }
  /* P2：当前项目是否已有服务端真实目录 */
  function realDirFor(p) {
    if (!serviceOnline || !realProjects) return null;
    var hit = realProjects.filter(function (x) { return x.id === p.id; })[0];
    return hit ? hit.dir : null;
  }
  function fileToBase64(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(new Error('读取文件失败')); };
      r.readAsDataURL(f);
    });
  }
  function downloadJSON(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportLocalBackup() {
    var payload = {
      key: KEY, exportedAt: timeStr(), note: 'PC 网页工作台 localStorage 演示数据备份',
      projects: state.projects, customDict: state.customDict, dictVersion: state.dictVersion
    };
    downloadJSON(payload, 'localStorage-backup-' + stamp() + '.json');
    if (serviceOnline) {
      api('POST', '/api/backup', { payload: payload }).then(function (r) {
        if (r.status === 200) toast('备份已下载，并落盘到 data/ 目录', 'ok');
        else toast('已下载到浏览器；服务端落盘失败：' + (r.body.error || r.status), 'err');
      }).catch(function () { toast('已下载到浏览器；服务端未连接', 'err'); });
    } else {
      toast('服务未连接，备份仅下载到浏览器', '');
    }
  }
  /* 权限档 3 的写操作统一走这里，确认后才放行 */
  function withWriteConfirm(project, title, message, fn) {
    if (Number(project.permissionLevel) === 3) {
      confirmModal(title + '（权限档 3）', message, function () { fn(true); }, true);
    } else fn(false);
  }
  /* 新建项目时，若服务在线则同步创建真实目录（§6.2 三层结构） */
  function syncProjectToServer(p) {
    if (!serviceOnline) { toast('本地服务未连接：项目仅存浏览器演示数据，未创建真实目录', ''); return; }
    var payload = {
      id: p.id, code: p.code, name: p.name, type: p.type, titleMode: p.titleMode,
      description: p.description, permissionLevel: p.permissionLevel, confirmed: false
    };
    function doCreate(confirmed) {
      payload.confirmed = confirmed;
      api('POST', '/api/project', payload).then(function (r) {
        if (r.status === 403 && r.body.needConfirm) {
          confirmModal('权限档 3 · 创建需确认', '将新建真实项目目录。确认后执行？', function () { doCreate(true); }, true);
          return;
        }
        if (r.status === 201) {
          p.realDir = r.body.dir;
          addChange(p, 'create', 'N00', '同步创建真实项目目录：' + r.body.dir, '需求变更', 'workbuddy');
          save();
          toast('已同步创建真实项目目录', 'ok');
          loadRealProjects().then(function () { if (state.view === 'settings') render(); });
        } else {
          toast('真实目录创建失败：' + (r.body.error || r.status), 'err');
        }
      }).catch(function () { toast('服务未响应，项目仅存浏览器演示数据', 'err'); });
    }
    withWriteConfirm(p, '创建真实项目目录',
      '<b>影响范围：</b>将新建 <span class="mono">' + esc(p.id + '_' + p.code) + '</span> 目录及 §6.2 三层子目录、4 个 JSON 文件。<br><b>可逆性：</b>新建内容可删，不覆盖任何既有文件。<br><b>线上数据：</b>零写入。',
      function (confirmed) { doCreate(confirmed); });
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('#toastRoot').appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }
  function badge(s) { return '<span class="badge ' + (STATUS_CLASS[s] || '') + '">' + esc(s) + '</span>'; }
  function modal(title, bodyHtml, footHtml, wide) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close" data-act="close-modal">×</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') + '</div>';
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    $('#modalRoot').appendChild(mask);
    /* 自动聚焦第一个可见输入控件，减少一次鼠标点击 */
    setTimeout(function () {
      var cands = $$('.modal-body textarea, .modal-body input.ctl, .modal-body select.ctl', mask);
      for (var i = 0; i < cands.length; i++) {
        if (cands[i].offsetParent !== null && !cands[i].disabled) {
          try { cands[i].focus(); } catch (e) { /* 忽略不可聚焦元素 */ }
          break;
        }
      }
    }, 30);
    return mask;
  }
  function closeModal() { var m = $('.modal-mask'); if (m) m.remove(); }
  function confirmModal(title, message, onYes, danger) {
    var m = modal(title,
      '<div class="notice ' + (danger ? 'notice-warn' : 'notice-info') + '">' + message + '</div>',
      '<button class="btn" data-act="close-modal">取消</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-act="confirm-yes">确认执行</button>');
    m.querySelector('[data-act="confirm-yes"]').addEventListener('click', function () { m.remove(); onYes(); });
  }
  function opts(arr, cur) {
    return arr.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function selectField(label, key, arr, cur, hint, attrs) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<select class="ctl" data-field="' + key + '" ' + (attrs || '') + '>' + opts(arr, cur) + '</select>' +
      (hint ? '<div class="field-hint">' + hint + '</div>' : '') + '</div>';
  }
  function chipsField(label, key, arr, selected, multi, max) {
    var sel = selected || [];
    var counter = max ? ' <span class="chip-count" data-chip-count="' + key + '">已选 ' + sel.length + ' / ' + max + '</span>' : '';
    return '<div class="field"><label>' + esc(label) + (multi ? ' <span class="muted small">（可多选）</span>' : '') + counter + '</label>' +
      '<div class="ctl-row">' + arr.map(function (v) {
        return '<button type="button" class="chip' + (sel.indexOf(v) >= 0 ? ' on' : '') + '" data-chip="' + key + '" data-val="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div></div>';
  }
  function titleCaseFromTheme(t) {
    var g = (t.genre || [])[0] || '创作项目', s = (t.scene || [])[0] || '', m = (t.selling || [])[0] || '';
    return ['《' + (s || g) + '·' + (m || g) + '》', '《' + g + '：' + (m || '一次讲清') + '》', '《' + (s || g) + '的 30 秒》'];
  }
  function themeId(t) {
    function codes(arr, prefix) { return (arr || []).slice(0, 2).map(function (_, i) { return prefix + pad(i + 1); }).join('-'); }
    return 'THM-' + codes(t.genre, 'G') + '|' + codes(t.scene, 'S') + '|' + codes(t.selling, 'P') +
      '|' + ((t.mood || []).length ? 'M' : 'M00') + '|' + codes(t.audience, 'A');
  }
  function fileName(p, nodeId, cls, seq, ext, rev) {
    var st = stamp();
    if (CFG().namingTemplate === DICT.namingTemplate[2]) return cls + '-' + pad(seq) + '.' + ext;
    var base = p.code + '_' + p.version + '_' + nodeId + '_' + cls + '-' + pad(seq);
    if (CFG().namingTemplate === DICT.namingTemplate[1]) return base + '_' + st + '.' + ext;
    return base + '_final_r' + pad(rev || 1) + '_' + st + '.' + ext;
  }
  function addChange(p, action, node, summary, reason, actor) {
    var c = mkChange(action, node, summary, reason, actor);
    c.seq = p.changelog.length ? Math.max.apply(null, p.changelog.map(function (x) { return x.seq; })) + 1 : 1;
    p.changelog.push(c);
    p.updated = timeStr();
    save();
    return c;
  }
  function promptFor(p, nodeId) {
    var m = NODE_META[nodeId] || NODE_META.N01;
    var s = p.spec, t = p.theme;
    return [
      '【节点】' + nodeId + ' / ' + (NODE_DEFS.filter(function (d) { return d[0] === nodeId; })[0] || ['', ''])[1],
      '【项目】' + p.name + '（' + p.type + '）',
      '【创作描述】' + (p.description ? p.description : '（未填写）'),
      '【主题标签】' + (t.genre || []).join('、') + ' / ' + (t.scene || []).join('、') + ' / ' + (t.selling || []).join('、'),
      '【情绪 / 人群 / 结构】' + t.mood + ' / ' + (t.audience || []).join('、') + ' / ' + t.narrative,
      '【规格】' + s.resolution + ' / ' + s.aspectRatio + ' / ' + pixel(p) + ' / ' + s.fps + 'fps / ' + s.durationBand,
      '【风格】' + s.styleFlat + (s.styleAux && s.styleAux !== '无' ? '（辅助：' + s.styleAux + '）' : ''),
      '【运镜 / 转场 / 字幕】' + (s.cameraMove || '缓慢推近') + ' / ' + s.transition + ' / ' + s.subtitlePos,
      '【音色】' + s.voice + '，语速 ' + s.voiceRate,
      '【匹配能力】' + m.capability + ' → ' + m.tool + (m.billable ? '（计费，需用户选择或确认）' : '（免费优先）'),
      '',
      '【项目强约束 G1 · 生图不带文字】画面生成类节点（N04/N06）的提示词与画面禁止出现任何文字、字符、字幕、笔迹、logo、水印；所需文案一律走 N07 后期字幕/标题叠层，不由生图渲染（AI 渲染中文易乱码）。',
      '【项目强约束 G2 · 水印擦除后交付】生图工具自带水印必须在交付前用图像擦除工具去除；擦除结果另存新版本（rev 递增），原始文件保留、不覆盖。',
      '【项目强约束 G3 · 句级说话状态对齐（降级）】当前视频模型无法由音频驱动音素级口型；提示词须写明「谁在说话、何时开口/闭口」使句级状态与台词匹配，禁止正面口部特写，近景改用侧脸/过肩/背影/画外音；不宣称音素级 lip-sync。',
      '约束：人物身份与服装全程一致；「中文渲染清晰无缺字方块」仅指 N10 后期字幕层，不适用于生图画面；输出 H.264/yuv420p + faststart 保证浏览器可预览。'
    ].join('\n');
  }
  function promptVersions(p, nodeId) {
    if (!p.promptVersions) p.promptVersions = {};
    if (!p.promptVersions[nodeId]) {
      p.promptVersions[nodeId] = [{ v: 1, text: promptFor(p, nodeId), ts: timeStr(), by: 'system' }];
    }
    return p.promptVersions[nodeId];
  }
  function simpleDiff(a, b) {
    var A = a.split('\n'), B = b.split('\n'), out = [], i, j;
    for (i = 0, j = 0; i < A.length || j < B.length;) {
      if (i < A.length && j < B.length && A[i] === B[j]) { out.push('  ' + A[i]); i++; j++; }
      else if (j < B.length && (i >= A.length || A.indexOf(B[j], i) < 0)) { out.push('+ ' + B[j]); j++; }
      else if (i < A.length) { out.push('- ' + A[i]); i++; }
      else { out.push('+ ' + B[j]); j++; }
    }
    return out.map(function (l) {
      if (l.indexOf('+ ') === 0) return '<span class="diff-add">' + esc(l) + '</span>';
      if (l.indexOf('- ') === 0) return '<span class="diff-del">' + esc(l) + '</span>';
      return esc(l);
    }).join('\n');
  }

  /* ============ 渲染：顶栏 ============ */
  function renderTopbar() {
    var sel = $('#projectSelect');
    sel.innerHTML = state.projects.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === state.currentProjectId ? ' selected' : '') + '>' + esc(p.name) + ' · ' + esc(p.type) + '</option>';
    }).join('');
    var p = P();
    var cls = p.status === '已交付' ? 's-ok' : (p.status === '待确认' ? 's-warn' : 's-run');
    $('#projectStatus').className = 'badge ' + cls;
    $('#projectStatus').textContent = p.status;
    $('#projectVersion').textContent = p.version + ' · ' + p.code;
  }

  /* ============ 渲染：项目列表 ============ */
  function renderProjects() {
    var typeOpts = ['全部类型'].concat(DICT.projectType);
    var statusOpts = ['全部状态', '进行中', '待确认', '已交付'];
    var html = '<div class="page-head"><div><h1>项目列表</h1>' +
      '<p>多项目创建 / 切换 / 管理。第一期仅支持 6 类项目类型，不含自定义模板（Q08）。全部筛选项为选择控件。</p></div>' +
      '<div class="page-actions"><button class="btn btn-primary" data-act="new-project">+ 新建项目</button></div></div>' +
      '<div class="card" style="margin-bottom:16px"><div class="card-body row row-wrap">' +
      '<span class="small muted">筛选</span>' +
      '<select class="ctl-select" id="fType" style="width:auto;min-width:170px">' + opts(typeOpts, '全部类型') + '</select>' +
      '<select class="ctl-select" id="fStatus" style="width:auto;min-width:140px">' + opts(statusOpts, '全部状态') + '</select>' +
      '<span class="spacer"></span><span class="small muted">共 ' + state.projects.length + ' 个项目 · 本地演示数据</span></div></div>' +
      '<div class="grid grid-3" id="projGrid">' + state.projects.map(projCard).join('') + '</div>';
    $('#view-projects').innerHTML = html;
    var f1 = $('#fType'), f2 = $('#fStatus');
    function apply() {
      $$('#projGrid .proj-card').forEach(function (c) {
        var okT = f1.value === '全部类型' || c.dataset.type === f1.value;
        var okS = f2.value === '全部状态' || c.dataset.status === f2.value;
        c.style.display = (okT && okS) ? '' : 'none';
      });
    }
    f1.addEventListener('change', apply); f2.addEventListener('change', apply);
  }
  function projCard(p) {
    var done = Object.keys(p.nodes).filter(function (k) { return p.nodes[k].status === '已通过' || p.nodes[k].status === '已跳过'; }).length;
    var pct = Math.round(done / NODE_DEFS.length * 100);
    return '<div class="card proj-card' + (p.id === state.currentProjectId ? ' on' : '') + '" data-project="' + esc(p.id) + '" data-type="' + esc(p.type) + '" data-status="' + esc(p.status) + '">' +
      '<div class="proj-thumb"><span>' + esc(p.code) + ' / ' + esc(p.spec.aspectRatio) + '</span></div>' +
      '<div class="proj-title">' + esc(p.name) + '</div>' +
      '<div class="proj-meta"><span class="tag">' + esc(p.type) + '</span><span class="tag">' + esc(p.spec.resolution) + '</span>' + badge(p.status) + '</div>' +
      '<div><div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="proj-foot" style="margin-top:7px"><span>节点 ' + done + '/' + NODE_DEFS.length + ' · 当前 ' + esc(p.currentNode) + '</span><span>' + esc(p.version) + '</span></div></div>' +
      '<div class="proj-foot"><span>更新 ' + esc(p.updated) + '</span><span class="mono">' + esc(p.id) + '</span></div></div>';
  }

  /* ============ 渲染：项目总览 ============ */
  function renderOverview() {
    var p = P(), done = Object.keys(p.nodes).filter(function (k) { return p.nodes[k].status === '已通过'; }).length;
    var recent = p.changelog.slice(-5).reverse();
    $('#view-overview').innerHTML = '<div class="page-head"><div><h1>' + esc(p.name) + '</h1>' +
      '<p>项目大纲与规格摘要 · 由枚举快照渲染，字段不可自由输入（Q18）。</p></div>' +
      '<div class="page-actions"><button class="btn" data-act="goto" data-view="flow">查看流程</button>' +
      '<button class="btn btn-primary" data-act="goto" data-view="node">打开当前节点</button></div></div>' +
      '<div class="grid grid-4" style="margin-bottom:16px">' +
      kpi('流程进度', done + ' / ' + NODE_DEFS.length, '当前节点 ' + p.currentNode) +
      kpi('当前版本', p.version, '版本策略：' + CFG().versionPolicy.split('（')[0]) +
      kpi('关联资产', p.assets.length + ' 项', '资产库引用 ' + p.assets.reduce(function (a, x) { return a + x.refs; }, 0) + ' 次') +
      kpi('变更记录', p.changelog.length + ' 条', '追加写 · 可归档/删除（Q19）') + '</div>' +
      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><h2>项目大纲</h2><div class="row"><span class="sub">outline.md / project.meta.json</span><button class="btn btn-sm" data-act="edit-title">编辑标题</button><button class="btn btn-sm" data-act="edit-description">编辑创作描述</button></div></div><div class="card-body">' +
      '<dl class="kv">' +
      kv('项目 ID', '<span class="mono">' + esc(p.id) + '</span>') + kv('项目代号', '<span class="mono">' + esc(p.code) + '</span>') +
      kv('项目类型', esc(p.type)) + kv('主题 ID', '<span class="mono">' + esc(themeId(p.theme)) + '</span>') +
      kv('标题来源', p.titleMode === 'custom' ? '自定义输入（自由文本白名单）' : '系统建议采纳') +
      kv('创作描述（' + charLen(p.description) + ' / 1000）',
        '<div class="desc-box">' + esc(p.description || '（未填写，点右上「编辑创作描述」补充）') + '</div>') +
      kv('题材 / 场景', esc((p.theme.genre || []).join('、') + ' / ' + (p.theme.scene || []).join('、'))) +
      kv('卖点 / 情绪', esc((p.theme.selling || []).join('、') + ' / ' + p.theme.mood)) +
      kv('人群 / 结构', esc((p.theme.audience || []).join('、') + ' / ' + p.theme.narrative)) +
      kv('分辨率 / 比例', esc(p.spec.resolution + ' / ' + p.spec.aspectRatio + ' → ' + pixel(p))) +
      kv('帧率 / 时长', esc(p.spec.fps + ' fps / ' + p.spec.durationBand)) +
      kv('视觉风格', esc(p.spec.styleFlat)) + kv('音色 / 语速', esc(p.spec.voice + ' / ' + p.spec.voiceRate)) +
      kv('投放平台', esc(p.spec.platform.join('、'))) + kv('输出编码', 'H.264 / yuv420p / AAC / faststart') +
      '</dl></div></div>' +
      '<div class="card"><div class="card-head"><h2>工作目录与命名</h2><span class="sub">§6 三层目录</span></div><div class="card-body">' +
      '<div class="field-label">自定义工作目录（Q05：同盘符、禁网络盘、允许中文路径）</div>' +
      '<div class="path-line" style="margin-bottom:12px">' + esc(p.workDir) + '</div>' +
      '<div class="field-label">三层目录规范</div><div class="enum-out">版本 / 文件类型 / 内容分类<br>' + esc(p.version) + ' / 03_asset / image、character、voice、font<br>' + esc(p.version) + ' / 04_output / storyboard、clip、master、qc<br>' + esc(p.version) + ' / 06_build（纯 ASCII 中间物）</div>' +
      '<div class="field-label" style="margin-top:14px">统一命名示例（Q17/Q06：新版本不覆盖）</div>' +
      '<div class="path-line">' + esc(fileName(p, 'N04', 'shot', 2, 'png', 1)) + '</div>' +
      '<div class="path-line" style="margin-top:6px">' + esc(fileName(p, 'N07', 'master', 1, 'mp4', 2)) + '</div>' +
      '<div class="notice notice-info mt-12">磁盘名全 ASCII，中文展示名存元数据；同一路径重名自动升修订号，系统不覆盖已有文件。</div>' +
      '</div></div></div>' +
      '<div class="card"><div class="card-head"><h2>最近变更</h2><button class="btn btn-sm" data-act="goto" data-view="changelog">查看全部</button></div>' +
      '<div class="card-body">' + (recent.length ? recent.map(function (c) {
        return '<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line-2)"><span class="tl-time">' + esc(c.ts) + '</span>' +
          '<span class="tag">' + esc(c.node) + '</span><span class="small">' + esc(c.summary) + '</span><span class="spacer"></span><span class="small muted">' + esc(c.reason) + '</span></div>';
      }).join('') : '<div class="empty">暂无变更</div>') + '</div></div>';
  }
  function kpi(l, v, s) { return '<div class="card kpi"><div class="kpi-label">' + esc(l) + '</div><div class="kpi-value">' + esc(v) + '</div><div class="kpi-sub">' + esc(s) + '</div></div>'; }
  function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }

  /* ============ 渲染：流程视图 ============ */
  function renderFlow() {
    var p = P();
    var strip = '<div class="flow-strip">';
    NODE_DEFS.forEach(function (d, i) {
      var st = p.nodes[d[0]].status;
      strip += '<div class="fs-node"><div class="fs-dot ' + (STATUS_CLASS[st] || '') + '">' + (st === '已通过' ? '✓' : d[0].slice(1)) + '</div><div class="fs-name">' + esc(d[1]) + '</div></div>';
      if (i < NODE_DEFS.length - 1) strip += '<div class="fs-line' + (st === '已通过' ? ' done' : '') + '"></div>';
    });
    strip += '</div>';
    $('#view-flow').innerHTML = '<div class="page-head"><div><h1>流程视图</h1>' +
      '<p>PC 端横向进度条 + 节点网格。状态机见 v1.1 §4.2；返工会使下游回到「未开始」，但已生成文件不删除。</p></div>' +
      '<div class="page-actions"><button class="btn" data-act="goto" data-view="node">打开当前节点 ' + esc(p.currentNode) + '</button></div></div>' +
      '<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>端到端进度</h2><span class="sub">' + esc(p.name) + ' · ' + esc(p.version) + '</span></div><div class="card-body">' + strip + '</div></div>' +
      '<div class="card"><div class="card-head"><h2>节点状态</h2><span class="sub">点击卡片进入节点详情</span></div><div class="card-body"><div class="flow-grid">' +
      NODE_DEFS.map(function (d) {
        var n = p.nodes[d[0]], m = NODE_META[d[0]], subs = d[3] || [];
        return '<div class="node-card' + (p.currentNode === d[0] ? ' on' : '') + '" data-act="open-node" data-node="' + d[0] + '">' +
          '<div class="nc-top"><span class="nc-code">' + d[0] + '</span>' + badge(n.status) + '</div>' +
          '<div class="nc-name">' + esc(d[1]) + '</div>' +
          '<div class="small muted">' + esc(d[2]) + '</div>' +
          (subs.length ? '<div class="nc-sub">随附 ' + subs.map(function (s) { return '<span class="tag tag-soft">' + esc(s) + '</span>'; }).join(' ') + '</div>' : '') +
          '<div class="nc-foot"><span>' + esc(m.tool) + '</span><span>' + (m.billable ? '计费需确认' : '免费优先') + '</span></div>' +
          (n.runs > 1 ? '<div style="margin-top:8px"><span class="tag">返工来源 · 第 ' + n.runs + ' 次</span></div>' : '') +
          '</div>';
      }).join('') + '</div></div></div>';
  }

  /* ============ 渲染：节点详情三区 ============ */
  /* 把输入区的分组标题包装成可折叠 details：PC 长表单可按需收起，不藏功能 */
  function groupInputZone(root) {
    var body = root && root.querySelector('.zone-body');
    if (!body) return;
    var labels = $$('.divider-label', body);
    if (!labels.length) return;
    labels.forEach(function (label, i) {
      var boundary = labels[i + 1] || null;
      var detail = document.createElement('details');
      detail.className = 'input-group';
      detail.open = true;
      var summary = document.createElement('summary');
      summary.textContent = label.textContent;
      detail.appendChild(summary);
      var grp = document.createElement('div');
      grp.className = 'grp-body';
      var node = label.nextSibling;
      while (node && node !== boundary) {
        var next = node.nextSibling;
        grp.appendChild(node);
        node = next;
      }
      detail.appendChild(grp);
      body.insertBefore(detail, label);
      label.remove();
    });
  }
  /* P0-1 / P0-2：素材登记就地列表。本原型只登记元数据，不保存文件本体 */
  function assetRegHtml(p, id) {
    var outs = p.nodes[id].outputs || [];
    var bar = '<div class="reg-bar' + (outs.length ? '' : ' empty') + '" id="regBar">' +
      '<span>已登记 ' + outs.length + ' 个素材元数据</span><span>仅登记 · 未落盘</span></div>';
    if (!outs.length) return bar + '<div class="reg-empty">尚未登记素材。选择文件后会在此就地列出，无需切页。</div>';
    return bar + '<div class="reg-list" id="regList">' + outs.map(function (o) {
      return '<div class="reg-item"><div class="ri-top">' +
        '<span class="ri-name">' + esc(o.name || '未命名素材') + '</span><span class="spacer"></span>' +
        '<button class="btn btn-sm btn-danger" data-act="remove-asset" data-out="' + esc(String(o.id || o.diskName)) + '">移除</button></div>' +
        '<div class="ri-meta">' + esc(o.kind || '素材') + ' · ' + (o.size != null ? esc(o.size + ' B') : '大小未记录') +
        ' · ' + esc(o.ts || '时间未记录') + '<br>系统命名 <span class="ri-disk">' + esc(o.diskName) + '</span>' +
        (o.realRel ? '<br><span class="ok-text">已落盘 <span class="ri-disk">' + esc(o.realRel) + '</span>（' + esc(o.realBytes + ' B') + '）</span>'
          : '<br><span class="muted">仅元数据 · 未落盘</span>') + '</div></div>';
    }).join('') + '</div>';
  }
  /* P1-2：模拟执行的逐步流程。全程不调用真实能力、不落盘 */
  function runLogHtml(logs) {
    return '<ol class="run-log">' + (logs || []).map(function (l) {
      return '<li class="' + (l.ok ? 'ok' : 'err') + '"><span class="rl-time">' + esc(l.ts) + '</span>' + esc(l.text) + '</li>';
    }).join('') + '</ol>';
  }
  function startRun(p, id, kind) {
    if (runState) { toast('已有执行进行中，请等待完成', 'err'); return; }
    var m = NODE_META[id];
    runState = {
      projectId: p.id, nodeId: id, kind: kind, tool: m.tool, capability: m.capability,
      startAt: timeStr(), idx: 0, logs: [], timer: null,
      steps: [
        '校验枚举输入快照与参数（主题 ID / 规格包 / 提示词版本）',
        '按「免费优先 → 优先级 → 成本」匹配能力：' + m.capability + ' → ' + m.tool,
        (kind === 'billable' ? '计费动作已人工确认，' : '') + '登记 CallRecord 与变更记录（模拟，不发起真实请求）',
        '汇总结果：产出文件 0，节点状态 → 待确认'
      ]
    };
    p.nodes[id].status = '执行中';
    p.nodes[id].lastRun = null;
    addChange(p, 'update', id, '开始执行（模拟流程）：' + m.tool, '参数调整', 'workbuddy');
    /* 执行期间冻结全局切换入口，避免 runState 与当前项目错位 */
    $$('#projectSelect, #btnNewProject, #btnExport, #btnHelp, #btnMode').forEach(function (e) { e.disabled = true; });
    save(); renderNode();
    tickRun();
  }
  function tickRun() {
    var rs = runState; if (!rs) return;
    if (rs.idx < rs.steps.length) {
      rs.logs.push({ ts: timeStr(), text: rs.steps[rs.idx], ok: true });
      rs.idx++;
      save(); renderNode();
      rs.timer = setTimeout(tickRun, 300);
      return;
    }
    finishRun();
  }
  function finishRun() {
    var rs = runState; if (!rs) return;
    var p = state.projects.filter(function (x) { return x.id === rs.projectId; })[0];
    if (!p) { runState = null; return; }
    p.callRecords.push(mkCall(rs.nodeId, rs.capability, rs.tool, 'succeeded', rs.kind === 'billable'));
    addChange(p, rs.kind === 'billable' ? 'confirm' : 'update', rs.nodeId,
      (rs.kind === 'billable' ? '用户确认后执行计费能力' : '执行本地/免费能力') + '（模拟、无产物）：' + rs.tool,
      rs.kind === 'billable' ? '需求变更' : '参数调整', rs.kind === 'billable' ? 'user' : 'workbuddy');
    p.nodes[rs.nodeId].lastRun = {
      ts: rs.startAt, endAt: timeStr(), kind: rs.kind, tool: rs.tool,
      status: 'succeeded（模拟登记）', outputsAdded: 0, logs: rs.logs
    };
    p.nodes[rs.nodeId].status = '待确认';
    runState = null;
    $$('#projectSelect, #btnNewProject, #btnExport, #btnHelp, #btnMode').forEach(function (e) { e.disabled = false; });
    save(); renderNode();
    toast('执行完成（模拟，产出文件 0）', 'ok');

    /* 计费动作：生成 WorkBuddy 桥接任务包（真实落盘，但本接口不调用模型、不消耗积分） */
    if (rs.kind === 'billable' && serviceOnline) {
      var slot = rs.nodeId === 'N06' ? 'video' : 'image';
      var route = (p.config && p.config.modelRoute && p.config.modelRoute[slot]) || {};
      var pvs = promptVersions(p, rs.nodeId), pvLast = pvs[pvs.length - 1];
      p.nodes[rs.nodeId].lastRun.taskPending = true;
      api('POST', '/api/model/task', {
        projectId: p.id, nodeId: rs.nodeId, slot: slot,
        channel: route.channel || DICT.modelChannel[0], model: route.model || '',
        billable: true, prompt: pvLast ? pvLast.text : '', confirmed: true,
        params: { resolution: p.spec.resolution, aspectRatio: p.spec.aspectRatio, fps: p.spec.fps }
      }).then(function (r) {
        var lr = p.nodes[rs.nodeId].lastRun;
        lr.taskPending = false;
        lr.taskId = r.status === 201 ? r.body.id : ('生成失败：' + (r.body.error || r.status));
        addChange(p, 'create', rs.nodeId,
          r.status === 201 ? '生成 WorkBuddy 桥接任务包（pending，未调用模型 / 未消耗积分）：' + r.body.id
            : '桥接任务包生成失败：' + (r.body.error || r.status), '参数调整', 'workbuddy');
        save(); if (state.view === 'node') renderNode();
        loadModelState();
      }).catch(function () {
        var lr2 = p.nodes[rs.nodeId].lastRun;
        lr2.taskPending = false; lr2.taskId = '生成失败：服务未响应';
        save(); if (state.view === 'node') renderNode();
      });
    }
  }
  /* P0-5 / P1-2：执行结果常驻卡片，含进行中与逐步日志 */
  function runResultHtml(p, id, m) {
    if (runState && runState.nodeId === id && runState.projectId === p.id) {
      return '<div class="run-card running" id="runResultCard">' +
        '<div class="rc-head">执行中 · ' + esc(runState.kind === 'billable' ? '计费能力（已确认）' : '免费 / 本地') +
        ' <span class="badge s-run">执行中 ' + runState.idx + ' / ' + runState.steps.length + '</span></div>' +
        '<div class="rc-body">开始时间：' + esc(runState.startAt) + '<br>节点：<span class="mono">' + esc(id) + '</span> · 能力：<span class="mono">' + esc(m.capability) + '</span><br>' +
        '匹配工具：' + esc(runState.tool) + '</div>' +
        '<div class="rc-logwrap">' + runLogHtml(runState.logs) + '</div>' +
        '<div class="rc-warn">本原型为<b>模拟流程</b>，不调用模型、不生成文件、不扣费。执行期间暂不可切换节点、离开页面或重复执行。</div></div>';
    }
    var r = p.nodes[id].lastRun;
    if (!r) return '<div class="run-empty" id="runResultCard">尚未执行。执行结果会显示在这里（含时间、能力、匹配工具、产出文件数与逐步日志）。</div>';
    var rtask = ((modelTasks && modelTasks.tasks) || []).filter(function (x) { return x.id === r.taskId; })[0];
    return '<div class="run-card" id="runResultCard">' +
      '<div class="rc-head">本次执行结果 · ' + esc(r.kind === 'billable' ? '计费能力（确认后）' : '免费 / 本地') + '</div>' +
      '<div class="rc-body">' +
      '时间：' + esc(r.ts) + (r.endAt ? ' → ' + esc(r.endAt) : '') + '<br>节点：<span class="mono">' + esc(id) + '</span> · 能力：<span class="mono">' + esc(m.capability) + '</span><br>' +
      '匹配工具：' + esc(r.tool) + '<br>结果状态：' + esc(r.status) + ' · <b>产出文件数 0</b>' +
      '</div>' +
      (r.logs && r.logs.length ? '<div class="rc-logwrap"><div class="rl-title">执行日志（' + r.logs.length + ' 步）</div>' + runLogHtml(r.logs) + '</div>' : '') +
      (r.taskId || r.taskPending ? '<div class="rc-logwrap"><div class="rl-title">WorkBuddy 桥接任务包</div>' +
        '<div class="call-item"><span class="mono">' + esc(r.taskPending ? '生成中…' : r.taskId) + '</span>' +
        (r.taskPending ? '' : (rtask && rtask.status !== 'pending'
          ? ' · <span class="badge s-ok">' + esc(rtask.status) + ' · ' + (rtask.receiptArtifacts || []).length + ' 个产物已回写</span>'
          : ' · <span class="badge s-warn">pending · 等待会话执行</span>')) +
        '<br><span class="muted">任务包已落盘 <span class="mono">data/tasks/</span>；由 WorkBuddy 会话读取后用真实模型执行，产物回写项目目录。本步骤<b>未调用模型、未消耗积分</b>。</span>' +
        (rtask && rtask.status !== 'pending' ? '<br><span class="muted">回执已就绪，可在「模型与协作」同步到本项目产物列表。</span>' : '') +
        '</div></div>' : '') +
      '<div class="rc-warn">本次为<b>模拟流程 + 桥接任务包</b>：本地服务未直接调用模型、未消耗积分，<b>未在项目目录生成产物</b>（输出区「本节点产物」不变）；调用记录与变更记录已写入' +
      (r.taskId ? '，桥接任务包已落盘 <span class="mono">data/tasks/</span>' : '') + '。</div>' +
      '<div class="rc-foot"><button class="btn btn-sm" data-act="goto" data-view="calls">查看调用记录</button>' +
      '<button class="btn btn-sm" data-act="goto" data-view="changelog">查看变更记录</button></div></div>';
  }
  /* P1-5：mini 进度条 + 上下节点，12 格可直接跳转 */
  function nodeProgressHtml(p, id) {
    var idx = NODE_DEFS.findIndex(function (d) { return d[0] === id; });
    var passed = NODE_DEFS.filter(function (d) {
      return p.nodes[d[0]].status === '已通过' || p.nodes[d[0]].status === '已跳过';
    }).length;
    var prev = idx > 0 ? NODE_DEFS[idx - 1][0] : '';
    var next = idx < NODE_DEFS.length - 1 ? NODE_DEFS[idx + 1][0] : '';
    var track = NODE_DEFS.map(function (d, i) {
      var st = p.nodes[d[0]].status;
      var cls = st === '已通过' || st === '已跳过' ? 'done' :
        (st === '返工中' || st === '失败' ? 'err' : (st === '待确认' || st === '待输入' ? 'warn' : ''));
      return '<button type="button" class="np-cell ' + cls + (d[0] === id ? ' cur' : '') + '"' +
        ' data-act="jump-node" data-node="' + d[0] + '" title="' + esc(d[0] + ' ' + d[1] + ' · ' + st) + '">' + (i + 1) + '</button>';
    }).join('');
    return '<div class="node-progress" id="nodeProgress">' +
      '<div class="np-bar"><span class="np-title">端到端进度</span>' +
      '<span class="np-count">第 ' + (idx + 1) + ' / 12 步 · 已通过 ' + passed + ' / 12</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="prev-node" data-node="' + prev + '"' + (prev ? '' : ' disabled') + '>← 上一节点</button>' +
      '<button class="btn btn-sm" data-act="next-node" data-node="' + next + '"' + (next ? '' : ' disabled') + '>下一节点 →</button></div>' +
      '<div class="np-track">' + track + '</div></div>';
  }
  /* P1-4：节点专属说明卡，12 个节点内容各异 */
  /**
   * 渲染项目强约束提示条（仅画面生成类节点在执行区展示）。
   * @returns {string} HTML 片段
   */
  function hardRulesHtml() {
    return '<div class="notice notice-warn" style="margin-bottom:12px"><b>项目强约束（不可跳过 · 随任务包导出）</b>' +
      PROJECT_HARD_RULES.map(function (r) {
        return '<div style="margin-top:7px"><span class="mono">' + r.id + '</span> · <b>' + esc(r.name) + '</b>：' + esc(r.rule) + '</div>';
      }).join('') +
      '<div class="small muted" style="margin-top:8px">文案需求一律走 N10 后期字幕/标题叠层；擦除结果另存新版本，原始文件保留。</div></div>';
  }
  /**
   * 输出区文件操作菜单：预检文件可用性后弹菜单（R2-01）。
   * 触发范围仅 .reg-item 主体；「复制命名」等已有按钮带自己的 data-act，不会冒泡触发本菜单。
   * @param {object} p 当前项目
   * @param {number} idx outputs 数组下标
   */
  function openFileMenu(p, idx) {
    var list = p.nodes[p.currentNode].outputs || [];
    var o = list[idx];
    if (!o) { toast('产物条目已变化，请刷新节点', 'err'); return; }
    if (!o.realRel) { toast('该条目仅登记元数据，未落盘，无文件可打开', 'err'); return; }
    var rel = o.realRel;
    var body = '<div class="file-menu-head"><div class="mono small">' + esc(o.diskName) + '</div>' +
      '<div class="small muted mt-8">相对路径：<span class="ri-disk">' + esc(rel) + '</span></div></div>' +
      '<div id="fileMenuBody"><div class="small muted" style="padding:12px 0">正在校验文件…</div></div>';
    modal('文件操作 · ' + (o.name || '未命名素材'), body,
      '<button class="btn" data-act="close-modal">关闭</button>' +
      '<button class="btn btn-sm" data-act="copy-diskname" data-name="' + esc(o.diskName) + '">复制磁盘名</button>', true);

    // 只读预检：服务端确认文件存在后才启用两项操作
    api('GET', '/api/file/stat?projectId=' + encodeURIComponent(p.id) + '&rel=' + encodeURIComponent(rel))
      .then(function (r) {
        var box = document.getElementById('fileMenuBody');
        if (!box) return;
        var j = r.body || {};
        if (!j.ok) {
          var msg = fileStatError(j);
          box.innerHTML = '<div class="notice notice-warn">' + esc(msg) + '</div>' +
            '<div class="small muted mt-8">两项操作已停用；可用下方「复制磁盘名」自行定位。</div>';
          return;
        }
        box.innerHTML =
          '<div class="notice notice-info">文件已确认存在（' + esc(j.bytes + ' B') + '）。选择操作：</div>' +
          '<div class="file-menu-list mt-12">' +
          '<button class="btn btn-primary" data-act="file-open" data-mode="default" data-rel="' + esc(rel) + '">用默认程序打开</button>' +
          '<button class="btn" data-act="file-open" data-mode="folder" data-rel="' + esc(rel) + '">打开所在文件夹</button>' +
          '</div><div class="small muted mt-12">打开动作只读取文件、不修改产物；每次会写入 ops.log 审计。</div>';
      })
      .catch(function () {
        var box = document.getElementById('fileMenuBody');
        if (box) box.innerHTML = '<div class="notice notice-warn">' + esc(fileStatError({ code: 'OFFLINE' })) + '</div>' +
          '<div class="small muted mt-8">菜单已降级为只提供「复制磁盘名」。</div>';
      });
  }

  /** 把预检错误码映射为用户可读反馈（5 类） */
  function fileStatError(j) {
    var map = {
      NO_REL: '该条目仅登记元数据，未落盘，无文件可打开',
      NOT_FOUND: '文件已不在预期路径，请检查是否被移动或清理',
      PATH_ESCAPE: '路径越界，已拒绝',
      INVALID_REL: '路径含非法字符，已拒绝',
      EXT_DENIED: '该文件类型不在打开白名单内，已拒绝',
      NOT_FILE: '目标不是文件',
      NO_PROJECT: '项目无真实目录，无法定位文件',
      OFFLINE: '本地数据服务未启动，请启动 server.js 后重试'
    };
    return map[j.code] || (j.error || '文件不可用');
  }

  /**
   * 请求服务端用默认程序打开 / 打开所在文件夹。
   * 打开失败自动降级为「打开所在文件夹」，并给出明确反馈。
   */
  function requestFileOpen(p, rel, mode) {
    api('POST', '/api/file/open', { projectId: p.id, rel: rel, mode: mode })
      .then(function (r) {
        var j = r.body || {};
        if (j.ok) { toast(mode === 'folder' ? '已打开所在文件夹' : '已请求系统默认程序打开', 'ok'); return; }
        var msg = fileStatError(j);
        if (j.code === 'OPEN_FAILED' && mode === 'default') {
          toast('系统未能打开该文件，已尝试定位到所在文件夹', 'err');
          // 降级：只重试一次 folder，避免循环
          return api('POST', '/api/file/open', { projectId: p.id, rel: rel, mode: 'folder' })
            .then(function (r2) { toast((r2.body || {}).ok ? '已打开所在文件夹' : '定位失败，请手动复制路径', (r2.body || {}).ok ? 'ok' : 'err'); })
            .catch(function () { toast('本地数据服务未启动，请启动 server.js 后重试', 'err'); });
        }
        toast(msg, 'err');
      })
      .catch(function () { toast(fileStatError({ code: 'OFFLINE' }), 'err'); });
  }

  function nodeBriefHtml(p, id) {
    var b = NODE_BRIEF[id] || {};
    function ul(arr) {
      return (arr && arr.length) ? '<ul>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div class="muted">—</div>';
    }
    return '<div class="node-brief" id="nodeBrief">' +
      '<div class="nb-head"><h3>本节点说明 · ' + esc(id) + ' ' + esc(defName(id)) + '</h3>' +
      '<span class="tag">' + esc(NODE_META[id].tool) + '</span>' +
      (NODE_META[id].billable ? '<span class="badge s-warn">计费需确认</span>' : '<span class="badge s-ok">免费优先</span>') +
      '</div><div class="nb-grid">' +
      '<div class="nb-col"><h4>目标</h4><p>' + esc(b.goal || '—') + '</p></div>' +
      '<div class="nb-col"><h4>输入清单</h4>' + ul(b.inputs) + '</div>' +
      '<div class="nb-col"><h4>期望产物</h4>' + ul(b.outputs) + '</div>' +
      '<div class="nb-col"><h4>完成判据</h4>' + ul(b.criteria) + '</div>' +
      '</div></div>';
  }
  /* P1-3：输出区直接显示本节点调用记录，不必跳到 P9 */
  function nodeCallsHtml(p, id) {
    var rs = (p.callRecords || []).filter(function (r) { return r.node === id; }).slice().reverse();
    if (!rs.length) return '<div class="reg-empty">本节点尚无调用记录。执行动作会在此与「调用配置与记录」页同步登记。</div>';
    return '<div class="call-list">' + rs.map(function (r) {
      return '<div class="call-item"><span class="mono">' + esc(r.ts) + '</span> · ' + esc(r.matched) +
        ' · ' + esc(r.status) + '<br><span class="muted">' + esc(r.cost) + ' · 耗时 ' + esc(r.duration) + '</span></div>';
    }).join('') + '</div>';
  }
  /* P1-7：完成判据自检。只作记录，不阻断通过（R2 = A 软闸门） */
  function criteriaHtml(p, id) {
    var arr = (NODE_BRIEF[id] || {}).criteria || [];
    var checked = p.nodes[id].criteriaChecked || {};
    if (!arr.length) return '<div class="reg-empty">本节点暂无完成判据。</div>';
    return '<div class="criteria-list">' + arr.map(function (c, i) {
      return '<label class="crit-item' + (checked[i] ? ' on' : '') + '">' +
        '<input type="checkbox" data-act="toggle-criteria" data-idx="' + i + '"' + (checked[i] ? ' checked' : '') + '>' +
        '<span>' + esc(c) + '</span></label>';
    }).join('') + '</div>' +
      '<div class="small muted" style="margin-top:7px">仅作人工自检记录，<b>不影响「通过」</b>（R2 = A 软闸门）；每次勾选写入变更记录。</div>';
  }
  /* P1-1：产物类型色块。原型不保存文件本体，不伪造缩略图 */
  function swatchCls(o) {
    var e = String(o.ext || '').toLowerCase();
    if (/^(png|jpg|jpeg|webp|gif)$/.test(e)) return 'sw-img';
    if (/^(mp3|wav|m4a|aac)$/.test(e)) return 'sw-audio';
    if (/^(ttf|otf|woff2?)$/.test(e)) return 'sw-font';
    if (/^(mp4|mov|webm)$/.test(e)) return 'sw-video';
    return 'sw-other';
  }
  /* 顶栏下拉、mini 进度条、上下节点统一走这里，复用未保存提示词保护 */
  function switchNode(next) {
    if (runState) { toast('执行进行中，请等待完成后再切换节点', 'err'); return; }
    var p = P();
    if (!next || !p.nodes[next] || next === p.currentNode) return;
    var apply = function () { p.currentNode = next; state.promptDirty = false; save(); renderNode(); };
    if (state.promptDirty) {
      confirmModal('有未保存的提示词修改',
        '切换节点会丢失未保存的编辑。建议先点「另存为新版本」。确认放弃并切换？', apply, true);
    } else apply();
  }
  /* 精简合并视图：随附子步骤（旧 N03/N05/N07/N11/N12）内嵌主节点执行区（v1.1 §4.1.1 §6） */
  function subStepInlineHtml(p, id) {
    var map = {
      N01: { title: '随附子步骤：能力盘点（旧 N03）', items: ['只读探测本机工具与素材', '产出能力清单 + 缺失项提示', '不改变任何文件'] },
      N04: { title: '随附子步骤', items: ['提示词预览（随附旧 N05，见本区提示词编辑器）', '生成后自动画面质检（旧 N07，生完即检·默认开启）'] },
      N05: { title: '随附子步骤：提示词预览（旧 N05）', items: ['本节点提示词由执行区编辑器渲染', '可另存为新版本'] },
      N06: { title: '随附子步骤：提示词预览（旧 N05）', items: ['本节点提示词由执行区编辑器渲染'] },
      N07: { title: '随附子步骤', items: ['合成后自动成片验收（旧 N11，合成后即验·默认开启）'] },
      N08: { title: '随附子步骤：归档（旧 N12，人工确认）', items: ['需人工点选「确认归档」', '不自动归档'] }
    };
    var cfg = map[id]; if (!cfg) return '';
    var html = '<div class="substep-box"><div class="ss-title">' + esc(cfg.title) + '</div><ul class="ss-list">';
    cfg.items.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
    html += '</ul>';
    if (id === 'N08') html += '<button class="btn btn-sm btn-primary" data-act="confirm-archive" title="人工确认归档（旧 N12 随附，不自动）">确认归档（N12）</button>';
    if (id === 'N04') html += '<label class="ss-switch"><input type="checkbox" checked disabled> 生成后自动画面质检（旧 N07·生完即检）</label>';
    if (id === 'N07') html += '<label class="ss-switch"><input type="checkbox" checked disabled> 合成后自动成片验收（旧 N11）</label>';
    html += '</div>';
    return html;
  }
  function renderNode() {
    var p = P(), id = p.currentNode, def = NODE_DEFS.filter(function (d) { return d[0] === id; })[0], m = NODE_META[id];
    var busy = !!runState && runState.nodeId === id && runState.projectId === p.id;
    var versions = promptVersions(p, id), last = versions[versions.length - 1];
    /* 仅同一节点内复用未保存的编辑内容，切换节点时回到该节点最新版本，避免串台 */
    var draft = (promptNodeId === id && $('#promptEditor')) ? $('#promptEditor').value : last.text;
    promptNodeId = id;
    var outputs = p.nodes[id].outputs || [];
    var nodeOptions = NODE_DEFS.map(function (d) { return d[0] + ' · ' + d[1]; });

    $('#view-node').innerHTML = '<div class="page-head"><div><h1>节点详情 · ' + id + ' ' + esc(def[1]) + '</h1>' +
      '<p>三区结构：输入区（全枚举） / 执行区（提示词可编辑 Q17） / 输出区（结果确认）。<b>执行区为模拟流程 + 桥接任务包，不直接调用模型</b>；文件本体与提示词可真实落盘。除白名单字段外界面无自由文本框。</p></div>' +
      '<div class="page-actions"><select class="ctl-select" id="nodeJump" style="width:auto;min-width:250px">' +
      NODE_DEFS.map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === id ? ' selected' : '') + '>' + esc(d[0] + ' · ' + d[1]) + '</option>'; }).join('') +
      '</select>' + badge(p.nodes[id].status) + '</div></div>' +
      nodeProgressHtml(p, id) +
      nodeBriefHtml(p, id) +
      '<div class="three-zone">' +
      /* 输入区 */
      '<div class="card zone"><div class="zone-head"><h3>① 输入区</h3><span class="zone-tag">INPUT</span></div><div class="zone-body">' +
      '<div class="notice notice-info" style="margin-bottom:14px">可枚举字段仍只提供选择控件、不接受手输；<b>项目标题与创作描述为非枚举白名单字段</b>，允许自由文本（本轮新增）。</div>' +
      '<div class="divider-label">项目创作描述（自由文本白名单 · ≤1000 字）</div>' +
      '<div class="desc-box">' + esc(p.description || '（未填写）') + '</div>' +
      '<div class="row mt-12"><span class="char-count" style="text-align:left;margin:0">' + charLen(p.description) + ' / 1000</span>' +
      '<span class="spacer"></span><button class="btn btn-sm" data-act="edit-description">编辑描述</button></div>' +
      '<div class="small muted" style="margin-top:7px">已注入本节点提示词；修改后已生成的提示词版本不自动改写，可在执行区「另存为新版本」刷新。</div>' +
      '<div class="divider-label">主题标签组合</div>' +
      chipsField('题材（≤2）', 'genre', dict('themeGenre'), p.theme.genre, true, 2) +
      chipsField('场景（≤2）', 'scene', dict('themeScene'), p.theme.scene, true, 2) +
      chipsField('卖点（≤2）', 'selling', dict('themeSelling'), p.theme.selling, true, 2) +
      selectField('情绪（单选）', 'mood', dict('themeMood'), p.theme.mood) +
      chipsField('目标人群', 'audience', dict('audience'), p.theme.audience, true) +
      '<div class="divider-label">规格包</div>' +
      selectField('视频分辨率', 'resolution', dict('resolution'), p.spec.resolution) +
      selectField('长宽比', 'aspectRatio', dict('aspectRatio'), p.spec.aspectRatio) +
      '<div class="field"><label>具体像素（联动只读）</label><div class="enum-out">' + esc(pixel(p)) + '</div></div>' +
      selectField('视觉风格（主）', 'styleFlat', dict('styleFlat'), p.spec.styleFlat) +
      selectField('辅助风格（最多 1 项）', 'styleAux', dict('styleAux'), p.spec.styleAux) +
      selectField('帧率', 'fps', dict('fps'), p.spec.fps) +
      selectField('投放平台', 'platform0', dict('platform'), p.spec.platform[0]) +
      '<div class="divider-label">素材登记 / 资产引用</div>' +
      '<div class="file-drop">选择文件后自动归类 + 按 §6.3 生成 ASCII 磁盘名' +
      '<input type="file" id="assetUpload" multiple accept="image/*,audio/*,.ttf,.otf"></div>' +
      '<div class="reg-tip">本原型<b>只登记元数据</b>（文件名 / 类型 / 大小 / 系统命名），不保存文件本体、不写入工作目录。登记结果在下方就地显示，并同步写入资产库与变更记录。</div>' +
      assetRegHtml(p, id) +
      '<div class="row mt-12"><button class="btn btn-sm" data-act="pick-asset">从资产库引用</button>' +
      '<button class="btn btn-sm" data-act="show-snapshot">查看输入快照</button></div>' +
      '<div class="divider-label">组合结果（只读）</div>' +
      '<div class="enum-out">主题 ID：' + esc(themeId(p.theme)) + '<br>候选标题：' + titleCaseFromTheme(p.theme).map(function (t, i) { return (i + 1) + '. ' + esc(t); }).join('<br>') + '</div>' +
      '<div class="row mt-12"><select class="ctl-select" id="titleAdopt">' + titleCaseFromTheme(p.theme).map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-sm" data-act="adopt-title">采纳标题</button></div>' +
      '</div></div>' +
      /* 执行区 */
      '<div class="card zone"><div class="zone-head"><h3>② 执行区</h3><span class="zone-tag">EXECUTE</span></div><div class="zone-body">' +
      (IMAGE_NODE_IDS[id] ? hardRulesHtml() : '') + subStepInlineHtml(p, id) +
      '<div class="row" style="margin-bottom:10px"><span class="tag">' + esc(m.capability) + '</span>' +
      '<span class="tag">' + esc(m.tool) + '</span>' + (m.billable ? '<span class="badge s-warn">计费能力·需确认</span>' : '<span class="badge s-ok">免费优先</span>') + '</div>' +
      '<div class="small muted" style="margin-bottom:12px">匹配规则（v1.1 §7.2）：免费能力优先 → 优先级 → 成本估算 → 历史成功率；命中计费能力需用户主动选择或单独确认。</div>' +
      '<div class="divider-label">输出提示词（Q17 允许编辑，另存为新版本）</div>' +
      '<textarea class="ctl" id="promptEditor" spellcheck="false">' + esc(draft) + '</textarea>' +
      '<div class="row row-wrap mt-12"><button class="btn btn-sm btn-primary" data-act="save-prompt">另存为新版本</button>' +
      '<button class="btn btn-sm" data-act="diff-prompt">版本对比</button>' +
      '<button class="btn btn-sm" data-act="copy-prompt">复制</button>' +
      '<span id="promptDirtyBadge" class="badge s-warn" hidden>未保存修改</span>' +
      '<span class="spacer"></span><span class="small muted">版本 v' + last.v + ' · ' + esc(last.ts) + '</span></div>' +
      '<div class="divider-label">参数快照（枚举，只读）</div>' +
      '<div class="enum-out">' + esc(p.spec.resolution + ' / ' + p.spec.aspectRatio + ' / ' + pixel(p) + ' / ' + p.spec.fps + 'fps / ' + p.spec.styleFlat) + '<br>' +
      '音色：' + esc(p.spec.voice + ' @ ' + p.spec.voiceRate) + '<br>转场：' + esc(p.spec.transition) + '<br>质检：' + esc(CFG().qcItems.join('、')) + '</div>' +
      '<div class="divider-label">执行动作</div>' +
      '<div class="row row-wrap"><button class="btn btn-sm" data-act="run-free"' + (busy ? ' disabled' : '') + ' title="进入执行中状态并展示逐步日志，完成后登记 1 条调用记录 + 1 条变更；不调模型、不生成文件">执行（免费/本地）</button>' +
      '<button class="btn btn-sm" data-act="run-billable"' + (busy ? ' disabled' : '') + ' title="先弹人工确认（成本估算未经核实）；确认后进入执行中流程，同样不发起真实请求、不扣费">执行计费能力</button>' +
      (directAvailableFor(p, id) ? '<button class="btn btn-sm btn-primary" data-act="invoke-wanx" title="走通义万相真实生图：消耗阿里云额度，产物落地项目目录 v1/03_asset/image/">直连通义万相生图（真实·消耗额度）</button>' : '') +
      '<button class="btn btn-sm" data-act="export-node"' + (busy ? ' disabled' : '') + ' title="下载当前节点 JSON；不含调用记录（整项目包请用顶栏「导出任务包」）">导出节点任务包</button>' +
      '<button class="btn btn-sm" data-act="write-workdir"' + (busy ? ' disabled' : '') + ' title="把当前提示词与输入快照按 §6.2 写入项目真实目录，不覆盖任何既有文件">写入工作目录</button></div>' +
      '<div class="exec-notes">' +
      '<b>执行（免费/本地）</b>：记 1 条 CallRecord + 1 条变更记录，节点状态 → 待确认；<b>不调模型、不生成文件、不落盘</b>。<br>' +
      '<b>执行计费能力</b>：先弹确认框（成本估算 50–100 积分、未经核实）；确认后同样只登记记录，<b>不发起真实请求、不扣费</b>。<br>' +
      '<b>导出节点任务包</b>：下载当前节点 JSON；<b>不含调用记录</b>，需要请点顶栏「导出任务包」。' +
      '</div>' +
      '<div class="notice notice-warn mt-12">计费能力不会被自动调用：需在此处主动选择并二次确认（Q04）。本原型<b>不发起任何真实生成请求</b>；确认后生成 WorkBuddy 桥接任务包，由 WorkBuddy 会话用真实模型执行。</div>' +
      '<div class="small muted mt-12">本项目计费确认：' +
      ((p.billingConfirm || {}).mode === 'project-once'
        ? '<span class="badge s-warn">不再提示（仍写变更记录与审计）</span>'
        : '<span class="badge s-ok">每次确认</span>') +
      ' · 可在左侧「模型与协作」调整</div>' +
      runResultHtml(p, id, m) +
      '</div></div>' +
      /* 输出区 */
      '<div class="card zone"><div class="zone-head"><h3>③ 输出区</h3><span class="zone-tag">OUTPUT</span></div><div class="zone-body">' +
      '<div class="field-label">本节点产物（已落盘文件可点击打开）</div>' +
      (outputs.length ? '<div class="reg-list">' + outputs.map(function (o, oi) {
          var hasReal = !!o.realRel;
          return '<div class="reg-item' + (hasReal ? ' clickable' : '') + '"' +
            (hasReal ? ' data-act="file-menu" data-idx="' + oi + '" tabindex="0" role="button" title="点击弹出文件操作菜单"' : '') + '>' +
            '<div class="ri-top">' +
            '<span class="asset-swatch ' + swatchCls(o) + '">' + esc(String(o.ext || '?').toUpperCase()) + '</span>' +
            '<span class="ri-name">' + esc(o.name || '未命名素材') + '</span><span class="spacer"></span>' +
            (hasReal ? '<span class="ri-open-hint">点击操作 ▾</span>' : '') +
            '<button class="btn btn-sm" data-act="copy-diskname" data-name="' + esc(o.diskName) + '">复制命名</button></div>' +
            '<div class="ri-meta">' + esc(o.kind || '素材') + ' · ' + (o.size != null ? esc(o.size + ' B') : '—') +
            '<br><span class="ri-disk">' + esc(o.diskName) + '</span><br>' +
            (hasReal
              ? '<span class="ok-text">已落盘 <span class="ri-disk">' + esc(o.realRel) + '</span>' +
                (o.realBytes != null ? '（' + esc(o.realBytes + ' B') + '）' : '') + '</span>'
              : '<span class="muted">仅登记元数据 · 未落盘（打开菜单不可用）</span>') + '</div></div>';
        }).join('') + '</div>'
        : '<div class="empty" style="padding:20px">暂无产物。本节点尚无登记项；会话内生成的真实产物可通过「模型与协作 → 同步回执到本项目」登记。</div>') +
      '<div class="divider-label">本节点调用记录</div>' +
      nodeCallsHtml(p, id) +
      '<div class="divider-label">质检项（枚举）</div>' +
      '<div class="ctl-row">' + CFG().qcItems.map(function (q) { return '<span class="chip on">' + esc(q) + '</span>'; }).join('') + '</div>' +
      '<div class="divider-label">完成判据（自检记录）</div>' +
      criteriaHtml(p, id) +
      '<div class="divider-label">结果确认</div>' +
      selectField('返工原因（选择「返工」时必填）', 'reworkReason', dict('reworkReason'), dict('reworkReason')[0]) +
      '<div class="row row-wrap"><button class="btn btn-sm btn-primary" data-act="confirm-pass"' + (busy ? ' disabled' : '') + '>通过</button>' +
      '<button class="btn btn-sm" data-act="confirm-rework"' + (busy ? ' disabled' : '') + '>返工</button>' +
      '<button class="btn btn-sm" data-act="confirm-skip"' + (busy ? ' disabled' : '') + '>跳过</button></div>' +
      '<div class="small muted" style="margin-top:9px">「通过」= 人工确认本节点结果合格，不是执行动作。尚无产物或未执行时会二次确认并留痕；每次确认写变更记录，通过后解锁下游，返工使下游回到「未开始」。</div>' +
      '<div class="divider-label">节点状态</div>' + badge(p.nodes[id].status) +
      '</div></div></div>';

    $('#nodeJump').addEventListener('change', function () { switchNode(this.value); });
    $('#assetUpload').addEventListener('change', handleUpload);
    var pe = $('#promptEditor');
    if (pe) pe.addEventListener('input', function () {
      var vs = promptVersions(p, p.currentNode);
      state.promptDirty = pe.value !== vs[vs.length - 1].text;
      var b = $('#promptDirtyBadge');
      if (b) b.hidden = !state.promptDirty;
    });
    groupInputZone($('#view-node .three-zone > .zone'));
  }

  /* ============ 渲染：资产库 ============ */
  function renderAssets() {
    var all = state.projects.reduce(function (a, p) { return a.concat(p.assets); }, []);
    var tabs = ['全部', '图片', '角色', '音色', '字体'];
    var list = state.assetTab === '全部' ? all : all.filter(function (x) { return x.type === state.assetTab; });
    $('#view-assets').innerHTML = '<div class="page-head"><div><h1>资产库</h1>' +
      '<p>图片 / 角色 / 音色录入、分类、元数据、跨项目引用与版本状态。资产实体只存一份，跨项目为只读引用。</p></div>' +
      '<div class="page-actions"><button class="btn btn-primary" data-act="new-asset">+ 录入资产</button></div></div>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<button class="' + (state.assetTab === t ? 'on' : '') + '" data-act="asset-tab" data-tab="' + t + '">' + t + '</button>'; }).join('') + '</div>' +
      '<div class="card"><div class="card-head"><h2>资产清单</h2><span class="sub">共 ' + list.length + ' 项 · 点击卡片查看元数据</span></div><div class="card-body">' +
      (list.length ? '<div class="asset-grid">' + list.map(function (a) {
        return '<div class="asset-card" data-act="asset-detail" data-asset="' + esc(a.id) + '">' +
          '<div class="asset-cover"><span>' + esc(a.type) + '</span><span class="corner badge ' + (a.status === 'final' ? 's-ok' : 's-idle') + '">' + esc(a.status === 'final' ? '已启用' : '草稿') + '</span></div>' +
          '<div class="asset-info"><div class="ai-name">' + esc(a.name) + '</div>' +
          '<div class="ai-meta"><span>' + esc(a.category) + '</span><span>引用 ' + a.refs + '</span></div></div></div>';
      }).join('') + '</div>' : '<div class="empty">该分类下暂无资产</div>') + '</div></div>';
  }

  /* D8：资产库独立录入。全枚举、不开放自由文本、只登记元数据 */
  function assetCreateModal() {
    var p = P(), seqOpts = [];
    for (var i = 1; i <= 20; i++) seqOpts.push(String(i));
    var m = modal('录入资产（仅登记元数据）',
      '<div class="notice notice-info" style="margin-bottom:14px">与节点素材登记口径一致：<b>只登记元数据，不保存文件本体、不写入工作目录</b>。名称由「类型 + 分类 + 序号」系统生成，全部为选择控件，不开放自由文本；录入到当前项目。</div>' +
      '<div class="grid grid-2">' +
      selectField('资产类型', 'acType', DICT.assetType, DICT.assetType[0]) +
      selectField('内容分类', 'acCategory', DICT.assetCategory, DICT.assetCategory[0]) +
      selectField('版本状态', 'acStatus', ['已启用', '草稿'], '已启用') +
      selectField('序号', 'acSeq', seqOpts, '1') +
      '</div>' +
      '<div class="field-label" style="margin-top:14px">生成结果预览</div>' +
      '<div class="enum-out" id="acPreview"></div>',
      '<button class="btn" data-act="close-modal">取消</button><button class="btn btn-primary" id="acSave">登记资产</button>');
    function val(k) { var e = $('[data-field="' + k + '"]', m); return e ? e.value : ''; }
    function preview() {
      $('#acPreview', m).textContent = '名称：' + val('acType') + '-' + val('acCategory') + '-' + pad(val('acSeq')) +
        ' | 类型：' + val('acType') + ' | 分类：' + val('acCategory') + ' | 状态：' + val('acStatus');
    }
    $$('select', m).forEach(function (s) { s.addEventListener('change', preview); });
    preview();
    $('#acSave', m).addEventListener('click', function () {
      var t = val('acType'), c = val('acCategory'), st = val('acStatus');
      var nm = t + '-' + c + '-' + pad(val('acSeq'));
      var a = mkAsset(uid('AST'), nm, t, c, st === '已启用' ? 'final' : 'draft', '资产库手动录入 · 无文件本体', p.id);
      p.assets.push(a);
      addChange(p, 'create', p.currentNode, '资产库录入（仅元数据）：' + nm, '参数调整', 'user');
      save(); m.remove(); renderAssets();
      toast('已登记资产：' + nm, 'ok');
    });
  }

  /* ============ 渲染：变更记录 ============ */
  function renderChangelog() {
    var p = P();
    var acts = ['全部动作', 'create', 'update', 'confirm', 'reject', 'rollback', 'config_change', 'archive', 'delete_register', 'remove_asset'];
    var list = p.changelog.slice().reverse().filter(function (c) {
      return (state.changelogFilter === '全部动作' || c.action === state.changelogFilter) && !c.audit;
    });
    var archived = p.changelog.filter(function (c) { return c.archived; }).length;
    var audits = p.changelog.filter(function (c) { return c.audit; });
    $('#view-changelog').innerHTML = '<div class="page-head"><div><h1>变更记录</h1>' +
      '<p>changelog.jsonl 追加写。Q19/R3：允许归档与删除，删除需二次确认并自动追加 delete_register 审计摘要。</p></div>' +
      '<div class="page-actions"><select class="ctl-select" id="clFilter" style="width:auto;min-width:170px">' + opts(acts, state.changelogFilter) + '</select></div></div>' +
      '<div class="notice notice-warn" style="margin-bottom:16px">风险提示：删除会削弱完整追溯链且不可逆。建议日常只用「归档」；交付 / 商投类项目不建议删除。</div>' +
      '<div class="grid grid-2"><div class="card"><div class="card-head"><h2>时间线</h2><span class="sub">' + list.length + ' 条 · 已归档 ' + archived + ' 条</span></div><div class="card-body">' +
      (list.length ? '<div class="timeline">' + list.map(function (c) {
        var cls = c.action === 'confirm' ? 's-ok' : (c.action === 'reject' || c.action === 'rollback' ? 's-err' : '');
        return '<div class="tl-item ' + cls + '"><div class="tl-head"><span class="tl-time">#' + c.seq + ' ' + esc(c.ts) + '</span>' +
          '<span class="tag">' + esc(c.action) + '</span><span class="tag">' + esc(c.node) + '</span>' +
          (c.archived ? '<span class="badge s-idle">已归档</span>' : '') + '</div>' +
          '<div class="tl-body">' + esc(c.summary) + ' <span class="muted">（' + esc(c.reason) + ' · ' + esc(c.actor) + '）</span></div>' +
          '<div class="tl-actions"><button class="btn btn-sm" data-act="cl-diff" data-id="' + esc(c.id) + '">查看 diff</button>' +
          '<button class="btn btn-sm" data-act="cl-archive" data-id="' + esc(c.id) + '">归档</button>' +
          '<button class="btn btn-sm btn-danger" data-act="cl-delete" data-id="' + esc(c.id) + '">删除</button></div></div>';
      }).join('') + '</div>' : '<div class="empty">无匹配记录</div>') + '</div></div>' +
      '<div class="card"><div class="card-head"><h2>审计摘要（删除留痕）</h2><span class="sub">delete_register</span></div><div class="card-body">' +
      (audits.length ? audits.slice().reverse().map(function (c) {
        return '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)"><span class="tag">delete_register</span>' +
          '<span class="small">' + esc(c.summary) + '</span><span class="spacer"></span><span class="tl-time">' + esc(c.ts) + '</span></div>';
      }).join('') : '<div class="empty">尚未删除任何记录 · 追溯链完整</div>') +
      '<div class="notice notice-info mt-12">审计摘要只保留被删记录的 seq / id / ts / hash，不保留全文；删除后追溯链缺口会显式标注。</div>' +
      '</div></div></div>';
    $('#clFilter').addEventListener('change', function () { state.changelogFilter = this.value; renderChangelog(); });
  }

  /* ============ 渲染：调用配置与记录 ============ */
  function renderCalls() {
    var p = P(), c = CFG();
    $('#view-calls').innerHTML = '<div class="page-head"><div><h1>调用配置与记录</h1>' +
      '<p>WorkBuddy 技能 / 专家 / 模型匹配规则、用户自定义配置与 CallRecord。全部配置项为选择控件或步进器。</p></div></div>' +
      '<div class="grid grid-2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><h2>用户自定义配置</h2><button class="btn btn-sm" data-act="save-config">保存配置</button></div><div class="card-body">' +
      selectField('并发策略', 'cfg-concurrency', dict('concurrency'), c.concurrency, '蓝本实证：VideoGen 并行会 5000ms 超时，默认串行。') +
      selectField('超时档', 'cfg-timeout', dict('timeoutTier'), c.timeoutTier) +
      '<div class="field"><label>重试次数（0–5）</label><div class="stepper"><button data-act="retry-minus">−</button><span id="retryVal">' + c.retry + '</span><button data-act="retry-plus">+</button></div></div>' +
      selectField('生成档位', 'cfg-tier', dict('renderTier'), c.renderTier) +
      '<div class="field"><label>允许计费能力</label><label class="switch"><input type="checkbox" id="cfgBillable"' + (c.allowBillable ? ' checked' : '') + '>开启后仍需每次单独确认（Q04）</label></div>' +
      chipsField('质检项集', 'cfg-qc', dict('qcItems'), c.qcItems, true) +
      '</div></div>' +
      '<div class="card"><div class="card-head"><h2>能力匹配规则（只读）</h2><span class="sub">v1.1 §7.2</span></div><div class="card-body">' +
      '<div class="notice notice-info" style="margin-bottom:12px">优先级：用户覆盖 &gt; 节点默认 &gt; 平台推荐；<b>免费技能/模型优先</b>；计费能力需主动选择或确认；失败重试 1s/2s/4s 最多 3 次后降级。</div>' +
      '<table class="tbl"><thead><tr><th>节点</th><th>能力标签</th><th>首选</th><th>计费</th></tr></thead><tbody>' +
      NODE_DEFS.map(function (d) {
        var m = NODE_META[d[0]];
        return '<tr><td class="mono">' + d[0] + '</td><td>' + esc(m.capability) + '</td><td>' + esc(m.tool) + '</td>' +
          '<td>' + (m.billable ? '<span class="badge s-warn">需确认</span>' : '<span class="badge s-ok">免费/本地</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>' +
      '<div class="card"><div class="card-head"><h2>调用结果记录（CallRecord）</h2><span class="sub">共 ' + p.callRecords.length + ' 条 · 成本估算标「未经核实」</span></div><div class="card-body tight">' +
      (p.callRecords.length ? '<table class="tbl"><thead><tr><th>时间</th><th>节点</th><th>匹配能力</th><th>状态</th><th>耗时</th><th>成本</th><th>降级</th></tr></thead><tbody>' +
        p.callRecords.slice().reverse().map(function (r) {
          return '<tr><td class="tl-time">' + esc(r.ts) + '</td><td class="mono">' + esc(r.node) + '</td><td>' + esc(r.matched) + '</td>' +
            '<td>' + (r.status === 'succeeded' ? '<span class="badge s-ok">成功</span>' : '<span class="badge s-warn">' + esc(r.status) + '</span>') + '</td>' +
            '<td>' + esc(r.duration) + '</td><td class="small">' + esc(r.cost) + '</td><td class="small muted">' + esc(r.degraded) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="empty">暂无调用记录</div>') + '</div></div>';
  }

  /* ============ 渲染：项目设置 ============ */
  function realProjectListHtml() {
    if (!serviceOnline) return '服务未连接，无法读取真实项目';
    if (realProjects === null) return '读取中…';
    if (!realProjects.length) return '暂无真实项目目录';
    return realProjects.map(function (x) {
      return esc(x.id + ' / ' + (x.name || x.dir) + ' · 权限档 ' + x.permissionLevel);
    }).join('<br>');
  }
  function renderSettings() {
    var p = P(), c = CFG();
    $('#view-settings').innerHTML = '<div class="page-head"><div><h1>项目设置</h1>' +
      '<p>工作目录、命名模板、版本策略与节点模板开关。工作目录通过系统目录选择器指定，禁止手输路径。</p></div></div>' +
      '<div class="grid grid-2">' +
      '<div class="card"><div class="card-head"><h2>工作目录与文件规范</h2></div><div class="card-body">' +
      '<div class="field"><label>自定义工作目录（只读展示）</label><div class="path-line">' + esc(p.workDir) + '</div>' +
      '<div class="row mt-12"><button class="btn btn-sm" data-act="copy-path">复制路径</button>' +
      '<button class="btn btn-sm" data-act="pick-dir">选择目录（演示）</button>' +
      '<button class="btn btn-sm" data-act="edit-title">编辑项目标题</button>' +
      '<button class="btn btn-sm" data-act="edit-description">编辑创作描述</button></div></div>' +
      selectField('命名模板', 'set-naming', dict('namingTemplate'), c.namingTemplate) +
      selectField('版本策略', 'set-version', dict('versionPolicy'), c.versionPolicy) +
      '<div class="notice notice-info mt-12">Q06 系统硬约束：不自动覆盖、不自动删除；用户手动删除需二次确认并留痕。内部一律存相对路径，绝对路径只在边界生成。</div>' +
      '</div></div>' +
      '<div class="card"><div class="card-head"><h2>流程模板节点开关（Q08）</h2><span class="sub">不支持自定义模板</span></div><div class="card-body">' +
      NODE_DEFS.map(function (d) {
        return '<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line-2)"><span class="mono small">' + d[0] + '</span>' +
          '<span class="small">' + esc(d[1]) + '</span><span class="spacer"></span>' +
          '<label class="switch"><input type="checkbox" data-node-switch="' + d[0] + '"' + (c.nodeEnabled[d[0]] ? ' checked' : '') + '></label></div>';
      }).join('') +
      '<div class="row mt-16"><button class="btn btn-sm btn-primary" data-act="save-settings">保存设置</button>' +
      '<button class="btn btn-sm btn-danger" data-act="reset-data">重置演示数据</button></div>' +
      '</div></div></div>' +
      '<div class="card mt-16"><div class="card-head"><h2>项目强约束（全局生效 · 不可关闭）</h2><span class="sub">2026-11-10 放行</span></div><div class="card-body">' +
      PROJECT_HARD_RULES.map(function (r) {
        return '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)">' +
          '<span class="mono small">' + r.id + '</span><b class="small">' + esc(r.name) + '</b>' +
          '<span class="spacer"></span><span class="small muted">' + esc(r.scope) + '</span></div>' +
          '<div class="small mt-12">' + esc(r.rule) + '</div>' +
          '<div class="small muted" style="margin:6px 0 12px">落地方式：' + esc(r.enforce) + '</div>';
      }).join('') +
      '<div class="notice notice-warn">强约束为项目级固定规则，不提供开关；作用于所有画面生成类节点，并随任务包导出。文案需求一律走 N10 后期叠层。</div>' +
      '</div></div>' +
      '<div class="card mt-16"><div class="card-head"><h2>数据接入 · 本地 Node 服务（通道 ②）</h2>' +
      (serviceOnline ? '<span class="badge s-ok">已连接</span>' : '<span class="badge s-err">未连接</span>') +
      '</div><div class="card-body">' +
      '<div class="grid grid-2"><div>' +
      '<dl class="kv">' +
      kv('服务地址', '<span class="mono">http://127.0.0.1:8791/</span>') +
      kv('工作空间', '<span class="mono">WorkBuddy全流程短视频创作空间</span>') +
      kv('蓝本目录', '只读扫描，永不写入') +
      kv('线上业务数据', '零接入、零写入') +
      kv('只读扫描索引', scanSummary ? (scanSummary.total + ' 文件 / ' + (scanSummary.totalBytes / 1024 / 1024).toFixed(1) + ' MB') : '尚未生成') +
      '</dl>' +
      '<div class="row row-wrap mt-12"><button class="btn btn-sm" data-act="svc-check">检测服务</button>' +
      '<button class="btn btn-sm" data-act="scan-view">查看扫描索引</button>' +
      '<button class="btn btn-sm" data-act="backup-export">导出 localStorage 备份</button>' +
      '<button class="btn btn-sm" data-act="env-probe">本机能力探测（只读）</button>' +
      '<button class="btn btn-sm btn-primary" data-act="ensure-realdir">为当前项目创建真实目录</button></div>' +
      '<div class="small muted mt-12">当前项目真实目录：' +
      (realDirFor(p) ? '<span class="mono">' + esc(realDirFor(p)) + '</span> · 素材与提示词可真实落盘'
        : '尚未创建 · 素材与提示词目前只登记元数据，不落盘') + '</div>' +
      '</div><div>' +
      '<div class="field"><label>当前项目数据权限（服务端强制校验）</label>' +
      '<select class="ctl" data-field="set-perm">' + PERMISSION_LEVELS.map(function (o) {
        return '<option value="' + o.v + '"' + (Number(p.permissionLevel) === o.v ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select>' +
      '<div class="field-hint">' + esc((PERMISSION_LEVELS.filter(function (o) { return o.v === Number(p.permissionLevel); })[0] || {}).desc || '') + '</div></div>' +
      '<button class="btn btn-sm btn-primary" data-act="save-permission">保存权限档</button>' +
      '<div class="field-label" style="margin-top:16px">真实项目目录</div>' +
      '<div id="realProjectList" class="enum-out">' + realProjectListHtml() + '</div>' +
      (p.realDir ? '<div class="path-line" style="margin-top:8px">本项目：' + esc(p.realDir) + '</div>'
        : '<div class="small muted" style="margin-top:8px">本项目尚未创建真实目录（服务离线或未同步）</div>') +
      '</div></div>' +
      '<div class="notice notice-info mt-16">启动方式：双击同目录 <span class="mono">start-server.bat</span>，或运行 <span class="mono">node server.js</span>；浏览器打开 <span class="mono">http://127.0.0.1:8791/</span> 可同源访问。服务仅监听 127.0.0.1，所有写操作记入 <span class="mono">data/ops.log</span>。</div>' +
      '</div></div>';
  }

  /* ============ 渲染：枚举字典 ============ */
  function renderDict() {
    var keys = Object.keys(DICT_LABEL);
    $('#view-dict').innerHTML = '<div class="page-head"><div><h1>枚举字典</h1>' +
      '<p>Q09：初始字典按调研 / 蓝本 / 行业通识默认，允许用户增加数据字典；字典版本 ' + esc(state.dictVersion) + '。新增的是「选项」，项目表单仍只给选择控件。</p></div>' +
      '<div class="page-actions"><button class="btn btn-primary" data-act="dict-add">+ 新增选项</button></div></div>' +
      '<div class="notice notice-info" style="margin-bottom:16px">边界说明：仅「字典管理」配置功能允许录入选项名称（受控短文本，≤20 字）；所有<b>项目输入字段</b>仍禁止自由文本（Q18）。新增项登记来源、字典版本与创建时间，并写变更记录。</div>' +
      '<div class="card"><div class="card-head"><h2>字典项</h2><span class="sub">共 ' + keys.length + ' 组</span></div><div class="card-body">' +
      keys.map(function (k) {
        var custom = state.customDict[k] || [];
        return '<div class="dict-row"><div class="dict-key">' + esc(DICT_LABEL[k]) + '<small>' + esc(k) + '</small></div>' +
          '<div class="ctl-row">' + dict(k).map(function (v) {
            var isCustom = custom.indexOf(v) >= 0;
            return '<span class="chip' + (isCustom ? ' on' : '') + '" title="' + (isCustom ? '用户新增' : '默认项') + '">' + esc(v) + (isCustom ? ' · 自定义' : '') + '</span>';
          }).join('') + '</div><div class="small muted">' + dict(k).length + ' 项 · ' + custom.length + ' 自定义</div></div>';
      }).join('') + '</div></div>';
  }

  /* ============ 渲染：模型与协作（R3 规格） ============ */
  function credsHtml() {
    if (!serviceOnline) return '<div class="reg-empty">服务未连接，无法读取凭据状态</div>';
    if (!modelCredentials) return '<div class="reg-empty">读取中…</div>';
    var c = modelCredentials.configured || {}, e = modelCredentials.endpoints || {};
    function rows(obj) {
      return Object.keys(obj).map(function (k) {
        return '<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line-2)">' +
          '<span class="mono small">' + esc(k) + '</span><span class="spacer"></span>' +
          (obj[k] ? '<span class="badge s-ok">已配置</span>' : '<span class="badge s-idle">未配置</span>') + '</div>';
      }).join('');
    }
    return '<div class="notice notice-info" style="margin-bottom:10px">' + esc(modelCredentials.note) + '</div>' +
      '<div class="field-label">凭据环境变量（仅显示是否配置）</div>' + rows(c) +
      '<div class="field-label" style="margin-top:12px">endpoint 环境变量</div>' + rows(e) +
      '<div class="small muted mt-12">来源 <span class="mono">process.env</span> · 回显策略 <span class="mono">never</span> · 不写入日志 / 项目文件 / 文档</div>';
  }
  function modelTasksHtml() {
    if (!serviceOnline) return '<div class="reg-empty">服务未连接</div>';
    if (!modelTasks) return '<div class="reg-empty">读取中…</div>';
    if (!modelTasks.tasks || !modelTasks.tasks.length) return '<div class="reg-empty">暂无任务包。确认执行计费能力后会在此生成（状态 pending）。</div>';
    var p = P(), synced = p.syncedReceipts || [];
    return '<div class="call-list">' + modelTasks.tasks.slice(0, 10).map(function (t) {
      var done = t.status && t.status !== 'pending';
      var mine = t.projectId === p.id;
      var isSynced = synced.indexOf(t.id) >= 0;
      return '<div class="call-item"><div class="ri-top">' +
        '<span class="mono">' + esc(t.id) + '</span> · ' + esc(t.slot) + '<span class="spacer"></span>' +
        (done ? '<span class="badge s-ok">' + esc(t.status) + ' · ' + (t.receiptArtifacts || []).length + ' 个产物</span>'
          : '<span class="badge s-warn">pending</span>') + '</div>' +
        '<div class="muted" style="margin-top:5px">' + esc(t.ts) + ' · 项目 ' + esc(t.projectId) +
        ' · ' + (t.fileExists ? '任务包在' : '任务包已清理（索引保留作审计）') + '</div>' +
        (done && mine && !isSynced
          ? '<div class="row mt-12"><button class="btn btn-sm btn-primary" data-act="sync-receipt" data-task="' + esc(t.id) + '">同步回执到本项目</button></div>' : '') +
        (isSynced ? '<div class="small muted" style="margin-top:6px">已同步到本项目产物列表</div>' : '') +
        (done && !mine ? '<div class="small muted" style="margin-top:6px">不属于当前项目，请切到对应项目后同步</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function renderModels() {
    var p = P(), c = CFG(), bc = p.billingConfirm || { mode: 'always' };
    if (!c.modelRoute) c.modelRoute = JSON.parse(JSON.stringify(DEFAULT_CONFIG.modelRoute));
    $('#view-models').innerHTML = '<div class="page-head"><div><h1>模型与协作</h1>' +
      '<p>按能力槽位配置 LLM / 生图 / 视频 / TTS 的通道与模型；凭据只从本地环境变量读取；计费确认可设为项目级。</p></div>' +
      '<div class="page-actions"><button class="btn btn-sm" data-act="model-refresh">刷新状态</button></div></div>' +
      '<div class="notice notice-warn" style="margin-bottom:16px"><b>通道边界（不编造能力）：</b>WorkBuddy 的模型能力是会话内工具，独立 Node 服务<b>没有可直连的公开 HTTP 接口文档</b>。默认「WorkBuddy 桥接」= 工作台生成任务包 → WorkBuddy 会话用真实能力执行 → 产物回写项目目录，属半自动；<b>任务包本身不调用模型、不消耗积分</b>。自定义 HTTP 直连需你提供 endpoint 与官方接口文档，当前不可用。</div>' +
      '<div class="card"><div class="card-head"><h2>模型协作路由（项目级 · 全部选择控件）</h2><span class="sub">4 个能力槽位</span></div><div class="card-body">' +
      '<table class="tbl"><thead><tr><th>能力槽位</th><th>关联节点</th><th>通道</th><th>模型</th><th>计费</th></tr></thead><tbody>' +
      MODEL_SLOTS.map(function (s) {
        var r = c.modelRoute[s.key] || {};
        return '<tr><td>' + esc(s.label) + '</td><td><span class="mono">' + esc(s.nodes) + '</span></td>' +
          '<td><select class="ctl" data-model-route="' + s.key + '" data-kind="channel">' + opts(dict('modelChannel'), r.channel) + '</select></td>' +
          '<td><select class="ctl" data-model-route="' + s.key + '" data-kind="model">' + modelOptionsForSlot(s.key, r.channel, r.model) + '</select></td>' +
          '<td>' + (s.billable ? '<span class="badge s-warn">计费</span>' : '<span class="badge s-ok">免费</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="small muted mt-12">协作顺序：脚本 / LLM → 分镜图 / 生图 → 配音 / TTS → 片段 / 视频 → 剪辑合成。具体型号可在「枚举字典 → 新增选项」补充（Q09），项目表单不开放自由文本。</div>' +
      '</div></div>' +
      renderProviderRegistry() +
      '<div class="grid grid-2 mt-16">' +
      '<div class="card"><div class="card-head"><h2>凭据状态（只读）</h2></div><div class="card-body">' + credsHtml() + '</div></div>' +
      '<div class="card"><div class="card-head"><h2>计费确认（项目级）</h2></div><div class="card-body">' +
      selectField('确认方式', 'billing-mode', ['每次确认（默认）', '本项目不再提示'],
        bc.mode === 'project-once' ? '本项目不再提示' : '每次确认（默认）') +
      '<div class="notice notice-warn mt-12">「本项目不再提示」只对本项目生效，会跳过后续计费确认弹窗；<b>每次计费动作仍写变更记录与审计</b>，可随时切回。开启需二次确认。</div>' +
      (bc.mode === 'project-once' ? '<div class="badge s-warn mt-12">本项目已启用：计费不再提示 · ' + esc(bc.acknowledgedAt || '') + '</div>' : '') +
      '<div class="row mt-12"><button class="btn btn-sm btn-primary" data-act="billing-save">保存确认方式</button></div>' +
      '</div></div></div>' +
      '<div class="card mt-16"><div class="card-head"><h2>WorkBuddy 桥接任务包</h2><span class="sub">data/tasks/ · 状态 pending = 等待会话执行</span></div><div class="card-body">' +
      modelTasksHtml() + '</div></div>' +
      '<div class="card mt-16"><div class="card-head"><h2>仍需你提供（不编造平台能力）</h2></div><div class="card-body">' +
      '<table class="tbl"><thead><tr><th>项</th><th>说明</th><th>影响</th></tr></thead><tbody>' +
      '<tr><td>WorkBuddy 模型 HTTP 接口文档</td><td>endpoint、鉴权方式、请求/响应结构，需以官方一手资料核实</td><td>拿到后才能做「工作台自动直连」，否则只能走任务包桥接</td></tr>' +
      '<tr><td>自定义 endpoint</td><td>现已可在上方「模型提供商」登记（Base URL + API Key 环境变量名 + 模型名 + 能力标签），登记后即在路由「自定义 HTTP 接口」通道的模型下拉中可选</td><td>登记即可选模型；真实直连仍需官方接口文档 + 鉴权实现，否则继续走任务包桥接</td></tr>' +
      '<tr><td>计费口径</td><td>每次确认已实现；「本项目不再提示」已实现</td><td>真实积分消耗发生在 WorkBuddy 会话执行任务包时，不在本地服务</td></tr>' +
      '</tbody></table></div></div>';
  }

  /* 按能力槽位生成「模型」下拉项：自定义 HTTP 通道时从提供商注册表拉取（按提供商分组） */
  function modelOptionsForSlot(slotKey, channel, selected) {
    var chCustom = DICT.modelChannel[1]; /* 自定义 HTTP 接口（需配置 endpoint） */
    if (channel === chCustom) {
      var provs = (modelProviders || []).filter(function (x) { return (x.capabilities || []).indexOf(slotKey) >= 0; });
      if (!provs.length) return '<option value="" disabled>— 请先在下方「模型提供商」新增支持「' + esc(SLOT_LABEL[slotKey]) + '」的提供商 —</option>';
      return provs.map(function (x) {
        var inner = (x.models || []).map(function (m) {
          var v = x.id + '::' + m;
          return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(m) + '</option>';
        }).join('');
        var label = x.name + ((x.tags && x.tags.length) ? ' · ' + x.tags.join('·') : '');
        return '<optgroup label="' + esc(label) + '">' + inner + '</optgroup>';
      }).join('');
    }
    /* 桥接 / 本地通道：沿用内置字典选项 */
    var slot = MODEL_SLOTS.filter(function (s) { return s.key === slotKey; })[0];
    return opts(dict(slot.dict), selected);
  }

  /* N06 直连：通义万相真实生图可用性判定（通道=自定义 HTTP 且选中 mp_wanx） */
  function directAvailableFor(p, id) {
    if (id !== 'N04') return false;
    var rt = (p.config && p.config.modelRoute && p.config.modelRoute.image) || {};
    if (rt.channel !== DICT.modelChannel[1]) return false;
    return (rt.model || '').indexOf('mp_wanx') === 0;
  }
  /* 由规格 aspectRatio 推导通义万相 size 参数 */
  function sizeForSpec(spec) {
    var r = (spec && spec.aspectRatio) || '9:16';
    if (r === '1:1') return '1024*1024';
    if (r === '16:9') return '1536*1024';
    if (r === '4:3') return '1024*768';
    if (r === '3:4') return '768*1024';
    return '1024*1536'; /* 默认 9:16 竖屏 */
  }
  /* N04 直连通义万相：调用后端真实执行器并登记产物 */
  function invokeWanxDirect(p, id, model, size, prompt) {
    toast('正在真实调用通义万相生成…（通常 10–40s）', 'ok');
    api('POST', '/api/model/providers/invoke', {
      providerId: 'mp_wanx', projectId: p.id, nodeId: 'N04', slot: 'image',
      model: model, prompt: prompt, size: size, confirmed: true
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        var a = (r.body.artifacts || [])[0];
        if (a) {
          p.nodes[id].outputs.push({ name: a.name, kind: '分镜图', ext: 'png', diskName: a.name, realRel: a.rel, realBytes: a.bytes, size: a.bytes });
          addChange(p, 'create', id, '真实调用通义万相生成分镜图（消耗额度，已落盘）：' + a.rel, '参数调整', 'workbuddy');
          p.callRecords.push(mkCall(id, 'image_gen', '通义万相·真实', 'succeeded', true));
        }
        save(); renderNode();
        toast('通义万相生图完成，产物已落地：' + (a ? a.rel : '(无产物)'), 'ok');
      } else {
        toast('调用失败：' + ((r.body && (r.body.error || r.body.detail)) || ('HTTP ' + r.status)), 'err');
      }
    }).catch(function (e) {
      toast('请求未响应：' + ((e && e.message) || ''), 'err');
    });
  }

  /* 「模型提供商（自定义配置）」卡片：列表 + 新增入口，参考 WorkBuddy 模型自定义配置 */
  function renderProviderRegistry() {
    var provs = modelProviders || [];
    var cred = modelCredentials;
    function keyBadge(env) {
      if (!env) return '<span class="badge s-ok">无需 Key</span>';
      var ok = cred && cred.providerEnv && cred.providerEnv[env];
      return ok ? '<span class="badge s-ok">Key 已配置</span>' : '<span class="badge s-warn">Key 未配置</span>';
    }
    var body = provs.length ? (
      '<table class="tbl"><thead><tr><th>名称</th><th>类型</th><th>Base URL</th><th>能力</th><th>模型数</th><th>推荐 / 标签</th><th>Key</th><th>操作</th></tr></thead><tbody>' +
      provs.map(function (x) {
        var caps = (x.capabilities || []).map(function (c) { return '<span class="chip">' + esc(SLOT_LABEL[c] || c) + '</span>'; }).join('');
        var tierBadge = (x.tier && TIER_VALUES.indexOf(x.tier) >= 0) ? '<span class="' + (TIER_CLASS[x.tier] || 'tier') + '">' + esc(x.tier) + '</span> ' : '';
        var tagChips = (x.tags || []).filter(function (t) { return TAG_VALUES.indexOf(t) >= 0; })
          .map(function (t) { return '<span class="tag ' + (TAG_CLASS[t] || '') + '">' + esc(t) + '</span>'; }).join(' ');
        return '<tr>' +
          '<td>' + esc(x.name) + '</td>' +
          '<td>' + esc(PROVIDER_TYPE_LABEL[x.type] || x.type) + '</td>' +
          '<td class="mono small">' + (x.baseUrl ? esc(x.baseUrl) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (caps || '<span class="muted">—</span>') + '</td>' +
          '<td>' + (x.models ? x.models.length : 0) + '</td>' +
          '<td class="tag-cell">' + tierBadge + (tagChips || '<span class="muted">—</span>') + '</td>' +
          '<td>' + keyBadge(x.apiKeyEnv) + '</td>' +
          '<td class="row">' +
            '<button class="btn btn-sm" data-act="provider-edit" data-id="' + esc(x.id) + '">编辑</button>' +
            '<button class="btn btn-sm" data-act="provider-test" data-id="' + esc(x.id) + '">测试</button>' +
            '<button class="btn btn-sm btn-danger" data-act="provider-delete" data-id="' + esc(x.id) + '">删除</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>'
    ) : '<div class="reg-empty">尚未配置任何模型提供商。点击下方「新增提供商」，按 WorkBuddy 模型自定义配置的方式登记 OpenAI 兼容 / 自定义 HTTP / 本地能力（含 Base URL、API Key 环境变量名、能力标签与模型清单）。</div>';
    return '<div class="card mt-16"><div class="card-head"><h2>模型提供商（自定义配置）</h2>' +
      '<span class="sub">参考 WorkBuddy 模型自定义配置 · 全局 · ' + provs.length + ' 个</span>' +
      '<div class="spacer"></div><button class="btn btn-sm btn-primary" data-act="provider-add">+ 新增提供商</button></div>' +
      '<div class="card-body">' + body + '</div></div>';
  }

  /* 新增 / 编辑提供商弹层 */
  function providerFormModal(editId) {
    var x = editId ? (modelProviders.filter(function (p) { return p.id === editId; })[0]) : null;
    var types = ['openai-compatible', 'custom-http', 'local'];
    var capOpts = SLOT_KEYS.map(function (c) {
      var on = x && (x.capabilities || []).indexOf(c) >= 0;
      return '<label class="chk"><input type="checkbox" name="provCap" value="' + c + '"' + (on ? ' checked' : '') + '> ' + esc(SLOT_LABEL[c]) + '</label>';
    }).join('');
    var body =
      '<div class="field"><label>名称 *</label><input class="ctl" id="provName" maxlength="40" value="' + esc(x ? x.name : '') + '" placeholder="如：我的 DeepSeek / MiniMax TTS"></div>' +
      '<div class="field"><label>类型</label><select class="ctl" id="provType">' + types.map(function (t) { return '<option value="' + t + '"' + (x && x.type === t ? ' selected' : '') + '>' + esc(PROVIDER_TYPE_LABEL[t]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Base URL（可选）</label><input class="ctl" id="provBase" value="' + esc(x ? (x.baseUrl || '') : '') + '" placeholder="https://api.xxx.com/v1"></div>' +
      '<div class="field"><label>API Key 环境变量名</label><input class="ctl" id="provKeyEnv" value="' + esc(x ? (x.apiKeyEnv || '') : '') + '" placeholder="如 MINIMAX_API_KEY（仅填变量名，不存 key 值）"><div class="small muted">凭据只从本地环境变量读取；不落地、不回显、不进入项目文件。</div></div>' +
      '<div class="field"><label>能力标签（可多选）</label><div class="chk-row">' + capOpts + '</div></div>' +
      '<div class="field"><label>推荐档位</label><select class="ctl" id="provTier">' + TIER_VALUES.map(function (t) { return '<option value="' + t + '"' + (x && x.tier === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>推荐标签（可多选）</label><div class="chk-row">' + TAG_VALUES.map(function (t) { var on = x && (x.tags || []).indexOf(t) >= 0; return '<label class="chk"><input type="checkbox" name="provTag" value="' + t + '"' + (on ? ' checked' : '') + '> ' + esc(t) + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><label>模型名清单（每行一个）</label><textarea class="ctl" id="provModels" rows="4" placeholder="deepseek-chat\ndeepseek-reasoner">' + esc(x ? (x.models || []).join('\n') : PROVIDER_DEFAULT_MODELS['openai-compatible']) + '</textarea></div>' +
      '<div class="field"><label>备注</label><input class="ctl" id="provNote" value="' + esc(x ? (x.note || '') : '') + '" placeholder="可选"></div>';
    var foot = '<button class="btn" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="provider-save" data-id="' + (editId || '') + '">保存</button>';
    modal(x ? '编辑模型提供商' : '新增模型提供商', body, foot, true);
  }

  /* 持久化提供商注册表：本地缓存 + 服务端 PUT（confirmed=用户显式保存即确认） */
  function persistProviders() {
    try { localStorage.setItem('vcworkbench.providers', JSON.stringify(modelProviders)); } catch (e) {}
    if (!serviceOnline) { render(); toast('服务离线，已存本地；恢复服务后自动同步', 'ok'); return; }
    api('PUT', '/api/model/providers', { providers: modelProviders, confirmed: true })
      .then(function (r) {
        if (r.status === 200) { loadModelState().then(function () { render(); }); toast('模型提供商已保存并同步', 'ok'); }
        else if (r.status === 403) { toast('需权限确认：' + ((r.body && r.body.error) || ''), 'err'); render(); }
        else { toast('保存失败：' + ((r.body && r.body.error) || r.status), 'err'); }
      })
      .catch(function () { toast('保存请求失败（服务可能离线）', 'err'); });
  }

  /* ============ 视图切换 ============ */
  var VIEWS = ['projects', 'overview', 'flow', 'node', 'assets', 'changelog', 'calls', 'settings', 'dict', 'models'];
  var RENDER = {
    projects: renderProjects, overview: renderOverview, flow: renderFlow, node: renderNode,
    assets: renderAssets, changelog: renderChangelog, calls: renderCalls,
    settings: renderSettings, dict: renderDict, models: renderModels
  };
  function render() {
    renderTopbar();
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== state.view; });
    RENDER[state.view]();
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === state.view); });
  }
  function go(view) {
    if (runState && state.view === 'node' && view !== 'node') {
      toast('执行进行中，请等待完成后再离开节点详情', 'err'); return;
    }
    if (state.view === 'node' && view !== 'node' && state.promptDirty) {
      confirmModal('有未保存的提示词修改',
        '离开节点详情会丢失未保存的提示词编辑。建议先点「另存为新版本」。确认放弃并离开？',
        function () { state.promptDirty = false; state.view = view; render(); }, true);
      return;
    }
    state.view = view; render();
  }

  /* ============ 交互 ============ */
  function handleUpload(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var p = P(), id = p.currentNode;
    var baseLen = (p.nodes[id].outputs || []).length; /* P0-3：序号基准只取一次 */
    var newOuts = [];
    files.forEach(function (f, i) {
      var ext = (f.name.split('.').pop() || 'bin').toLowerCase();
      var type = /^(png|jpg|jpeg|webp)$/.test(ext) ? '图片' : (/^(mp3|wav|m4a)$/.test(ext) ? '音色' : '字体');
      var cls = NODE_META[id].cls;
      var disk = fileName(p, id, cls, baseLen + i + 1, ext, 1);
      var aid = uid('AST');
      var a = mkAsset(aid, f.name.replace(/\.[^.]+$/, ''), type, '上传素材', 'final', f.size + ' B', p.id);
      a.diskName = disk;
      p.assets.push(a);
      if (!p.nodes[id].outputs) p.nodes[id].outputs = [];
      var o = { id: uid('OUT'), assetId: aid, name: f.name, diskName: disk, ext: ext,
        size: f.size, ts: timeStr(), kind: type, realRel: null };
      p.nodes[id].outputs.push(o);
      newOuts.push(o);
      addChange(p, 'create', id, '登记素材元数据：' + disk, '参数调整', 'user');
    });
    var dir = realDirFor(p);
    if (!dir) {
      save(); renderNode();
      toast('已登记 ' + files.length + ' 个素材元数据；当前项目无真实目录，未落盘（可在「项目设置 → 数据接入」创建）', '');
      return;
    }
    /* P2：服务在线且项目已有真实目录 → 文件本体按 §6.2 落盘 */
    var doPersist = function (confirmed) {
      Promise.all(files.map(function (f, i) {
        var ext = (f.name.split('.').pop() || 'bin').toLowerCase();
        return fileToBase64(f).then(function (b64) {
          return api('POST', '/api/asset/upload', {
            projectId: p.id, nodeId: id, filename: f.name, ext: ext,
            dataBase64: b64, confirmed: !!confirmed
          }).then(function (r) { return { r: r, out: newOuts[i] }; });
        });
      })).then(function (rs) {
        var ok = 0, fail = 0;
        rs.forEach(function (x) {
          if (x.r.status === 201) { x.out.realRel = x.r.body.rel; x.out.realBytes = x.r.body.bytes; ok++; }
          else fail++;
        });
        addChange(p, 'create', id, '素材文件本体落盘：成功 ' + ok + ' / 失败 ' + fail + '（§6.2 三层目录，不覆盖）', '参数调整', 'workbuddy');
        save(); renderNode();
        toast('已落盘 ' + ok + ' 个文件' + (fail ? '，失败 ' + fail + ' 个' : '') + '（未覆盖任何既有文件）', fail ? 'err' : 'ok');
      }).catch(function (err) {
        save(); renderNode(); toast('文件落盘失败：' + err.message + '；元数据登记已保留', 'err');
      });
    };
    withWriteConfirm(p, '上传文件到真实工作目录',
      '<b>影响范围：</b>将向 <span class="mono">' + esc(dir) + '</span> 新增 <b>' + files.length + '</b> 个文件（按 §6.2 三层目录归位）。<br>' +
      '<b>不覆盖、不删除</b>任何既有文件；同名自动升 rev。<br><b>单文件上限：</b>5MB（原型演示）。<br>' +
      '<b>可逆性：</b>新增文件可删。<br><b>线上数据：</b>零写入。',
      doPersist);
  }
  function newProjectWizard() {
    var step = 1;
    var form = {
      type: DICT.projectType[0], resolution: '1080P', aspectRatio: '9:16',
      styleFlat: '3D 动画 / 皮克斯式卡通', fps: '30', durationBand: '15–30s', platform: ['抖音'],
      genre: ['带货种草'], scene: ['厨房'], selling: ['省时省力'], mood: '戏剧张力', audience: ['泛人群'],
      workDir: 'default',
      titleMode: 'suggest', title: '', customTitle: '', description: '', descTemplate: '不套用模板',
      permissionLevel: 3
    };
    var m = modal('新建项目 · 全枚举向导', '<div id="wizardBody"></div>',
      '<button class="btn" data-act="close-modal">取消</button><button class="btn" id="wPrev">上一步</button><button class="btn btn-primary" id="wNext">下一步</button>');
    function body() {
      var h = '<div class="wizard-steps"><span class="' + (step === 1 ? 'on' : '') + '">1 项目类型</span><span class="' + (step === 2 ? 'on' : '') + '">2 规格与主题</span><span class="' + (step === 3 ? 'on' : '') + '">3 工作目录</span></div>';
      if (step === 1) {
        h += '<div class="field-label">项目类型（第一期仅 6 类，Q08）</div><div class="radio-list">' + DICT.projectType.map(function (t) {
          return '<label class="radio-item' + (form.type === t ? ' on' : '') + '"><input type="radio" name="wType" value="' + esc(t) + '"' + (form.type === t ? ' checked' : '') + '>' + esc(t) + '</label>';
        }).join('') + '</div>';
      } else if (step === 2) {
        h += '<div class="grid grid-2">' + selectField('视频分辨率', 'w-res', dict('resolution'), form.resolution) +
          selectField('长宽比', 'w-ar', dict('aspectRatio'), form.aspectRatio) +
          selectField('视觉风格', 'w-style', dict('styleFlat'), form.styleFlat) +
          selectField('帧率', 'w-fps', dict('fps'), form.fps) +
          selectField('成片时长档', 'w-dur', dict('durationBand'), form.durationBand) +
          selectField('投放平台', 'w-plat', dict('platform'), form.platform[0]) + '</div>' +
          chipsField('题材', 'w-genre', dict('themeGenre'), form.genre, true, 2) +
          chipsField('场景', 'w-scene', dict('themeScene'), form.scene, true, 2) +
          chipsField('卖点', 'w-sell', dict('themeSelling'), form.selling, true, 2) +
          selectField('情绪', 'w-mood', dict('themeMood'), form.mood) +
          chipsField('目标人群', 'w-aud', dict('audience'), form.audience, true) +
          '<div class="field-whitelist">本页两个自由文本字段（项目标题、创作描述）属于<b>非枚举白名单字段</b>；分辨率 / 长宽比 / 风格 / 主题标签等可枚举字段仍只提供选择控件，不接受手输。</div>' +
          '<div class="field-label" style="margin-top:8px">项目标题（可采纳建议，也可自定义输入）</div>' +
          '<div class="seg mode-seg"><button type="button" class="' + (form.titleMode === 'suggest' ? 'on' : '') + '" data-title-mode="suggest">采纳系统建议</button>' +
          '<button type="button" class="' + (form.titleMode === 'custom' ? 'on' : '') + '" data-title-mode="custom">自定义输入</button></div>' +
          '<div id="titleSuggest"' + (form.titleMode === 'suggest' ? '' : ' hidden') + '><div class="radio-list">' +
          titleCaseFromTheme({ genre: form.genre, scene: form.scene, selling: form.selling }).map(function (t, i) {
            return '<label class="radio-item' + ((form.title || '') === t || (!form.title && i === 0) ? ' on' : '') + '"><input type="radio" name="wTitle" value="' + esc(t) + '"' + ((form.title || '') === t || (!form.title && i === 0) ? ' checked' : '') + '>' + esc(t) + '</label>';
          }).join('') + '</div></div>' +
          '<div id="titleCustom"' + (form.titleMode === 'custom' ? '' : ' hidden') + '>' +
          '<input class="ctl" id="wCustomTitle" maxlength="60" aria-label="自定义项目标题" value="' + esc(form.customTitle) + '" placeholder="输入项目标题，≤60 字">' +
          '<div class="char-count"><span id="wTitleCount">' + charLen(form.customTitle) + '</span> / 60</div>' +
          '<div class="field-error" id="wTitleError" hidden>自定义标题不能为空</div>' +
          '<div class="field-label" style="margin-top:10px">最终标题预览</div>' +
          '<div class="enum-out" id="wTitlePreview">' + esc(finalTitle(form) || '（未填写）') + '</div></div>' +
          '<div class="field-label" style="margin-top:16px">创作描述（自由文本，≤1000 字）</div>' +
          '<div class="row" style="margin-bottom:8px">' +
          '<select class="ctl-select" id="wTpl" aria-label="创作描述模板" style="flex:1">' +
          opts(['不套用模板'].concat(DICT.descriptionTemplate), form.descTemplate || '不套用模板') + '</select>' +
          '<button type="button" class="btn btn-sm" id="wApplyTpl">套用模板</button></div>' +
          '<div class="field"><textarea class="ctl-textarea" id="wDesc" maxlength="1000" aria-label="创作描述" placeholder="可直接输入，也可从上方模板套用后修改…">' + esc(form.description) + '</textarea>' +
          '<div class="char-count"><span id="wDescCount">' + charLen(form.description) + '</span> / 1000 · 剩余 <span id="wDescLeft">' + (1000 - charLen(form.description)) + '</span> 字</div>' +
          '<div class="field-hint">模板只是可编辑的起点，套用后仍可自由修改。描述将注入各节点提示词、输入快照与任务包；创建后可在「项目总览 / 节点详情」继续编辑，每次修改写入变更记录。</div></div>';
      } else {
        h += '<div class="field-label">工作目录（系统目录选择器，禁止手输路径）</div>' +
          '<div class="radio-list"><label class="radio-item' + (form.workDir === 'default' ? ' on' : '') + '"><input type="radio" name="wDir" value="default"' + (form.workDir === 'default' ? ' checked' : '') + '>使用默认：&lt;工作空间&gt;/projects/&lt;项目ID&gt;_&lt;代号&gt;/</label>' +
          '<label class="radio-item' + (form.workDir === 'custom' ? ' on' : '') + '"><input type="radio" name="wDir" value="custom"' + (form.workDir === 'custom' ? ' checked' : '') + '>选择其他本地目录（同一盘符，禁网络盘 Q05）</label></div>' +
          '<div class="field-label" style="margin-top:18px">数据权限（写入本项目目录，创建后可在「项目设置」调整）</div>' +
          '<div class="radio-list">' + PERMISSION_LEVELS.map(function (o) {
            return '<label class="radio-item' + (Number(form.permissionLevel) === o.v ? ' on' : '') + '"><input type="radio" name="wPerm" value="' + o.v + '"' + (Number(form.permissionLevel) === o.v ? ' checked' : '') + '>' + esc(o.label) + ' <span class="small muted">· ' + esc(o.desc) + '</span></label>';
          }).join('') + '</div>' +
          '<div class="field-hint">权限档由本地服务端强制校验，不依赖前端开关；默认档 3（最严格）。档 3 创建真实目录时会弹二次确认。</div>' +
          '<div class="notice notice-info mt-16">创建后 project_type 不可改；项目代号由系统生成。标题可来自系统建议或自定义输入，创作描述 ≤1000 字。创建动作会写入变更记录。</div>' +
          '<div class="enum-out mt-16">项目标题：' + esc(finalTitle(form) || '（未填写）') +
          '<br>标题来源：' + (form.titleMode === 'custom' ? '自定义输入' : '系统建议采纳') +
          '<br>规格：' + esc(form.resolution + ' / ' + form.aspectRatio + ' / ' + form.fps + 'fps / ' + form.styleFlat) +
          '<br>创作描述（' + charLen(form.description) + ' / 1000）：' + esc(descPreview(form.description, 100) || '（未填写）') +
          '<br>数据权限：' + Number(form.permissionLevel) + ' 档（' + esc(PERMISSION_LEVELS.filter(function (o) { return o.v === Number(form.permissionLevel); })[0].label) + '）</div>';
      }
      $('#wizardBody', m).innerHTML = h;
      $('#wPrev', m).disabled = step === 1;
      $('#wNext', m).textContent = step === 3 ? '创建项目' : '下一步';
      bind(m);
    }
    function collect(m) {
      $$('input[name="wType"]:checked', m).forEach(function (x) { form.type = x.value; });
      ['res', 'ar', 'style', 'fps', 'dur', 'plat', 'mood'].forEach(function (k) {
        var el = $('[data-field="w-' + k + '"]', m); if (!el) return;
        if (k === 'res') form.resolution = el.value;
        if (k === 'ar') form.aspectRatio = el.value;
        if (k === 'style') form.styleFlat = el.value;
        if (k === 'fps') form.fps = el.value;
        if (k === 'dur') form.durationBand = el.value;
        if (k === 'plat') form.platform = [el.value];
        if (k === 'mood') form.mood = el.value;
      });
      ['genre', 'scene', 'sell', 'aud'].forEach(function (k) {
        var arr = $$('[data-chip="w-' + k + '"].on', m).map(function (b) { return b.dataset.val; });
        if (k === 'genre') form.genre = arr; if (k === 'scene') form.scene = arr;
        if (k === 'sell') form.selling = arr; if (k === 'aud') form.audience = arr;
      });
      var t = $('input[name="wTitle"]:checked', m); if (t) form.title = t.value;
      var ct = $('#wCustomTitle', m); if (ct) form.customTitle = ct.value;
      var dsc = $('#wDesc', m); if (dsc) form.description = dsc.value;
      var tp = $('#wTpl', m); if (tp) form.descTemplate = tp.value;
      var d = $('input[name="wDir"]:checked', m); if (d) form.workDir = d.value;
      var pm = $('input[name="wPerm"]:checked', m); if (pm) form.permissionLevel = Number(pm.value);
    }
    function bind(m) {
      $$('[data-chip]', m).forEach(function (b) {
        b.addEventListener('click', function () {
          collect(m);
          var k = b.dataset.chip;
          var onCount = $$('[data-chip="' + k + '"].on', m).length;
          if (!b.classList.contains('on') && onCount >= 2) { toast('该项最多选 2 个', 'err'); return; }
          b.classList.toggle('on');
          var cc = $('[data-chip-count="' + k + '"]', m);
          if (cc) cc.textContent = '已选 ' + $$('[data-chip="' + k + '"].on', m).length + ' / 2';
        });
      });
      /* 单选项只更新选中态，不重渲染整页，避免输入框失焦与光标丢失 */
      $$('input[type="radio"]', m).forEach(function (r) {
        r.addEventListener('change', function () {
          collect(m);
          $$('.radio-item', m).forEach(function (l) {
            var inp = l.querySelector('input[type="radio"]');
            l.classList.toggle('on', !!inp && inp.checked);
          });
        });
      });
      $$('select', m).forEach(function (s) { s.addEventListener('change', function () { collect(m); }); });
      $$('[data-title-mode]', m).forEach(function (b) {
        b.addEventListener('click', function () {
          collect(m);
          form.titleMode = b.dataset.titleMode;
          $$('[data-title-mode]', m).forEach(function (x) { x.classList.toggle('on', x === b); });
          var sg = $('#titleSuggest', m), cu = $('#titleCustom', m);
          if (sg) sg.hidden = form.titleMode !== 'suggest';
          if (cu) cu.hidden = form.titleMode !== 'custom';
          if (form.titleMode === 'custom') { var ci = $('#wCustomTitle', m); if (ci) ci.focus(); }
        });
      });
      var ct = $('#wCustomTitle', m);
      if (ct) ct.addEventListener('input', function () {
        form.customTitle = ct.value;
        var c = $('#wTitleCount', m); if (c) c.textContent = charLen(ct.value);
        var pv = $('#wTitlePreview', m); if (pv) pv.textContent = ct.value.trim() || '（未填写）';
        var empty = !ct.value.trim(), er = $('#wTitleError', m);
        ct.classList.toggle('invalid', empty);
        if (er) er.hidden = !empty;
      });
      var dsc = $('#wDesc', m);
      if (dsc) dsc.addEventListener('input', function () {
        form.description = dsc.value;
        var n = charLen(dsc.value);
        var c = $('#wDescCount', m), l = $('#wDescLeft', m);
        if (c) c.textContent = n;
        if (l) l.textContent = Math.max(0, 1000 - n);
        if (c && c.parentNode) {
          c.parentNode.classList.toggle('over', n >= 1000);
          c.parentNode.classList.toggle('near', n >= 800 && n < 1000);
        }
      });
      var tplBtn = $('#wApplyTpl', m);
      if (tplBtn) tplBtn.addEventListener('click', function () {
        collect(m);
        var name = form.descTemplate;
        if (!name || name === '不套用模板') { toast('请先选择一个创作描述模板', 'err'); return; }
        var text = TEMPLATE_TEXT[name] || '';
        var merged = form.description ? form.description.replace(/\s+$/, '') + '\n' + text : text;
        form.description = Array.from(merged).slice(0, 1000).join('');
        body();
        toast('已套用模板「' + name + '」，可继续修改', 'ok');
      });
    }
    function validateStep() {
      if (form.titleMode === 'custom' && !String(form.customTitle || '').trim()) {
        var er = $('#wTitleError', m); if (er) er.hidden = false;
        var ci = $('#wCustomTitle', m); if (ci) { ci.classList.add('invalid'); ci.focus(); }
        toast('自定义标题不能为空，或切回「采纳系统建议」', 'err'); return false;
      }
      if (charLen(form.description) > 1000) {
        toast('创作描述不能超过 1000 字', 'err'); return false;
      }
      return true;
    }
    $('#wPrev', m).addEventListener('click', function () { collect(m); if (step > 1) { step--; body(); } });
    $('#wNext', m).addEventListener('click', function () {
      collect(m);
      if (!validateStep()) return;
      if (step < 3) { step++; body(); return; }
      createProject(form); m.remove();
    });
    body();
  }
  function finalTitle(f) {
    if (f.titleMode === 'custom') return (f.customTitle || '').trim();
    return f.title || titleCaseFromTheme({ genre: f.genre, scene: f.scene, selling: f.selling })[0];
  }
  function createProject(f) {
    var n = state.projects.length + 1;
    var id = 'P_' + stamp().slice(0, 8) + '_' + pad(n, 3);
    var code = (f.type === '口播科普' ? 'KC' : f.type === '产品宣传片' ? 'PP' : f.type === '剧情短剧·漫剧' ? 'DJ' : f.type === '音乐 MV·混剪' ? 'MV' : f.type === '图文动效·Vlog' ? 'VG' : 'DS') + pad(n, 2);
    var nodes = {};
    NODE_DEFS.forEach(function (d, i) { nodes[d[0]] = { status: i === 0 ? '待输入' : '未开始', runs: 1, outputs: [] }; });
    var p = {
      id: id, code: code, name: finalTitle(f),
      type: f.type, status: '进行中', version: 'v1',
      titleMode: f.titleMode, description: String(f.description || '').slice(0, 1000),
      permissionLevel: Number(f.permissionLevel) || 3,
      workDir: 'D:\\WorkBuddy_space\\WorkBuddy全流程短视频创作空间\\projects\\' + id + '_' + code,
      created: timeStr(), updated: timeStr(),
      spec: { resolution: f.resolution, aspectRatio: f.aspectRatio, styleFlat: f.styleFlat, styleAux: '无', fps: f.fps, durationBand: f.durationBand, clipSeconds: '5s', platform: f.platform, renderTier: '标准(720P)', transition: '硬切', subtitlePos: '底部居中', voice: DICT.voice[0], voiceRate: '+8%', watermark: '不主动添加（默认，Q10）' },
      theme: { genre: f.genre, scene: f.scene, selling: f.selling, mood: f.mood, audience: f.audience, narrative: '冲突-转折-解决' },
      nodes: nodes, currentNode: 'N01', changelog: [], callRecords: [], assets: [], promptVersions: {}, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    };
    p.changelog.push(mkChange('create', 'N00',
      '通过全枚举向导创建项目 ' + p.name + '（标题：' + (f.titleMode === 'custom' ? '自定义输入' : '系统建议采纳') +
      '；创作描述 ' + charLen(p.description) + ' 字；数据权限 ' + p.permissionLevel + ' 档）', '需求变更', 'user'));
    p.changelog[0].seq = 1;
    state.projects.push(p);
    state.currentProjectId = id;
    save(); go('overview');
    toast('项目已创建：' + p.name + '（权限档 ' + p.permissionLevel + '）', 'ok');
    syncProjectToServer(p);
  }
  function currentPromptText() {
    var p = P(), vs = promptVersions(p, p.currentNode);
    var ta = $('#promptEditor');
    return ta ? ta.value : vs[vs.length - 1].text;
  }
  function exportBundle(nodeOnly) {
    var p = P();
    var data = {
      meta: { generator: '视频创作工作台 PC v1 原型', exportedAt: timeStr(), note: '纯前端本地演示数据，不含任何线上业务数据' },
      project: { id: p.id, code: p.code, name: p.name, titleMode: p.titleMode, type: p.type,
        version: p.version, status: p.status, workDir: p.workDir,
        permissionLevel: p.permissionLevel, realDir: p.realDir || null },
      outline: { themeId: themeId(p.theme), theme: p.theme, spec: p.spec, pixel: pixel(p), description: p.description, descriptionLength: charLen(p.description) },
      /* 项目强约束随任务包导出，确保会话内真实生图时也遵守 G1/G2 */
      hardRules: PROJECT_HARD_RULES,
      hardRuleScope: Object.keys(IMAGE_NODE_IDS),
      namingExample: fileName(p, p.currentNode, NODE_META[p.currentNode].cls, 1, 'png', 1),
      nodes: nodeOnly ? { [p.currentNode]: p.nodes[p.currentNode] } : p.nodes,
      prompt: nodeOnly ? currentPromptText() : undefined,
      config: CFG(), changelog: nodeOnly ? undefined : p.changelog,
      callRecords: nodeOnly ? undefined : p.callRecords
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.code + '_' + p.version + (nodeOnly ? '_' + p.currentNode : '') + '_taskbundle_' + stamp() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('任务包已导出（本地 JSON）', 'ok');
  }
  function findAsset(id) {
    var found = null;
    state.projects.forEach(function (p) { p.assets.forEach(function (a) { if (a.id === id) found = { a: a, p: p }; }); });
    return found;
  }
  function assetDetail(id) {
    var x = findAsset(id); if (!x) return;
    var a = x.a;
    modal('资产详情 · ' + a.name,
      '<dl class="kv">' + kv('资产 ID', '<span class="mono">' + esc(a.id) + '</span>') +
      kv('展示名', esc(a.name)) + kv('磁盘名', '<span class="mono">' + esc(a.diskName) + '</span>') +
      kv('类型 / 分类', esc(a.type + ' / ' + a.category)) + kv('来源项目', '<span class="mono">' + esc(a.sourceProject) + '</span>') +
      kv('规格元数据', esc(a.meta)) + kv('版本状态', badge(a.status === 'final' ? '已通过' : '待确认')) +
      kv('授权状态', esc(a.license)) + kv('AI 生成', a.aiGenerated ? '是' : '否') +
      kv('水印', esc(a.watermark)) + kv('引用次数', String(a.refs)) + kv('创建时间', esc(a.created)) + '</dl>' +
      '<div class="notice notice-info mt-16">跨项目复用为只读引用，不复制文件；引用绑定具体版本，源资产升级后历史引用仍指向旧版。</div>',
      '<button class="btn" data-act="close-modal">关闭</button><button class="btn btn-primary" data-act="ref-asset" data-asset="' + esc(a.id) + '">引用到当前项目</button>', true);
  }
  function editTitleModal() {
    var p = P();
    var mode = p.titleMode || 'suggest';
    var custom = mode === 'custom' ? p.name : '';
    var suggestions = titleCaseFromTheme(p.theme);
    var body =
      '<div class="notice notice-info" style="margin-bottom:14px">项目标题可在「采纳系统建议」与「自定义输入」间切换；修改会写入变更记录。可枚举字段仍只提供选择控件。</div>' +
      '<div class="field-label">标题模式</div>' +
      '<div class="seg mode-seg"><button type="button" class="' + (mode === 'suggest' ? 'on' : '') + '" data-et-mode="suggest">采纳系统建议</button>' +
      '<button type="button" class="' + (mode === 'custom' ? 'on' : '') + '" data-et-mode="custom">自定义输入</button></div>' +
      '<div id="etSuggest"' + (mode === 'suggest' ? '' : ' hidden') + '><div class="radio-list">' +
      suggestions.map(function (t, i) {
        var on = (p.name === t) || (suggestions.indexOf(p.name) < 0 && i === 0);
        return '<label class="radio-item' + (on ? ' on' : '') + '"><input type="radio" name="etTitle" value="' + esc(t) + '"' + (on ? ' checked' : '') + '>' + esc(t) + '</label>';
      }).join('') + '</div></div>' +
      '<div id="etCustom"' + (mode === 'custom' ? '' : ' hidden') + '>' +
      '<input class="ctl" id="etCustomInput" maxlength="60" aria-label="自定义项目标题" value="' + esc(custom) + '" placeholder="输入项目标题，≤60 字">' +
      '<div class="char-count"><span id="etCount">' + charLen(custom) + '</span> / 60</div>' +
      '<div class="field-error" id="etError" hidden>标题不能为空</div></div>' +
      '<div class="field-label" style="margin-top:14px">最终标题预览</div>' +
      '<div class="enum-out" id="etPreview">' + esc(p.name) + '</div>';
    var m = modal('编辑项目标题', body,
      '<button class="btn" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="save-title">保存</button>');
    function curTitle() {
      if (mode === 'custom') { var ci = $('#etCustomInput', m); return ci ? ci.value : ''; }
      var r = $('input[name="etTitle"]:checked', m);
      return r ? r.value : suggestions[0];
    }
    function refreshPreview() {
      var pv = $('#etPreview', m);
      if (pv) pv.textContent = curTitle().trim() || '（未填写）';
    }
    $$('[data-et-mode]', m).forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.dataset.etMode;
        $$('[data-et-mode]', m).forEach(function (x) { x.classList.toggle('on', x === b); });
        var sg = $('#etSuggest', m), cu = $('#etCustom', m);
        if (sg) sg.hidden = mode !== 'suggest';
        if (cu) cu.hidden = mode !== 'custom';
        refreshPreview();
        if (mode === 'custom') { var ci = $('#etCustomInput', m); if (ci) ci.focus(); }
      });
    });
    $$('input[name="etTitle"]', m).forEach(function (r) { r.addEventListener('change', refreshPreview); });
    var ci = $('#etCustomInput', m);
    if (ci) ci.addEventListener('input', function () {
      var c = $('#etCount', m); if (c) c.textContent = charLen(ci.value);
      var er = $('#etError', m), empty = !ci.value.trim();
      ci.classList.toggle('invalid', empty);
      if (er) er.hidden = !empty;
      refreshPreview();
    });
    m.querySelector('[data-act="save-title"]').addEventListener('click', function () {
      var t = curTitle().trim();
      if (!t) { toast('标题不能为空', 'err'); var er = $('#etError', m); if (er) er.hidden = false; return; }
      if (charLen(t) > 60) { toast('标题不能超过 60 字', 'err'); return; }
      if (t === p.name && mode === (p.titleMode || 'suggest')) { m.remove(); return; }
      p.name = t; p.titleMode = mode;
      addChange(p, 'update', p.currentNode,
        '更新项目标题：' + t + '（' + (mode === 'custom' ? '自定义输入' : '系统建议采纳') + '）', '需求变更', 'user');
      save(); m.remove(); render(); toast('项目标题已更新', 'ok');
    });
  }
  function editDescriptionModal() {
    var p = P();
    var m = modal('编辑创作描述（≤1000 字）',
      '<div class="notice notice-info" style="margin-bottom:14px">非枚举白名单字段。修改会写入变更记录，并作为后续节点提示词的输入依据；已生成的提示词版本不自动改写，可在节点执行区「另存为新版本」刷新。</div>' +
      '<div class="row" style="margin-bottom:8px">' +
      '<select class="ctl-select" id="editTpl" aria-label="创作描述模板" style="flex:1">' +
      opts(['不套用模板'].concat(DICT.descriptionTemplate), '不套用模板') + '</select>' +
      '<button type="button" class="btn btn-sm" id="editApplyTpl">套用模板</button></div>' +
      '<div class="field"><label>创作描述</label>' +
      '<textarea class="ctl-textarea" id="editDesc" maxlength="1000" aria-label="创作描述" placeholder="描述视频主题、剧情、卖点、风格要求、必须出现或禁止出现的元素…">' + esc(p.description || '') + '</textarea>' +
      '<div class="char-count"><span id="editDescCount">0</span> / 1000 · 剩余 <span id="editDescLeft">1000</span> 字</div>' +
      '<div class="field-hint">按 Unicode 码点计字；模板只是可编辑的起点。纯文本，不接受富文本、脚本或凭据类内容。</div></div>',
      '<button class="btn" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="save-description">保存</button>');
    var ta = $('#editDesc', m), cnt = $('#editDescCount', m), left = $('#editDescLeft', m);
    function upd() {
      var n = charLen(ta.value);
      cnt.textContent = n;
      if (left) left.textContent = Math.max(0, 1000 - n);
      cnt.parentNode.classList.toggle('over', n >= 1000);
      cnt.parentNode.classList.toggle('near', n >= 800 && n < 1000);
    }
    ta.addEventListener('input', upd); upd();
    $('#editApplyTpl', m).addEventListener('click', function () {
      var name = $('#editTpl', m).value;
      if (name === '不套用模板') { toast('请先选择一个创作描述模板', 'err'); return; }
      var text = TEMPLATE_TEXT[name] || '';
      var merged = ta.value ? ta.value.replace(/\s+$/, '') + '\n' + text : text;
      ta.value = Array.from(merged).slice(0, 1000).join('');
      upd(); ta.focus();
      toast('已套用模板「' + name + '」，可继续修改', 'ok');
    });
    m.querySelector('[data-act="save-description"]').addEventListener('click', function () {
      var v = ta.value;
      if (charLen(v) > 1000) { toast('超过 1000 字，请精简后再保存', 'err'); return; }
      if (v === (p.description || '')) { m.remove(); return; }
      p.description = v;
      addChange(p, 'update', p.currentNode, '更新创作描述（' + charLen(v) + ' 字）', '需求变更', 'user');
      save(); m.remove(); render(); toast('创作描述已保存，已写入变更记录', 'ok');
    });
  }
  function dictAddModal() {
    var keys = Object.keys(DICT_LABEL);
    var m = modal('新增字典项（Q09）',
      selectField('所属字典', 'd-key', keys.map(function (k) { return DICT_LABEL[k]; }), DICT_LABEL.resolution) +
      '<div class="field"><label>选项名称（受控短文本，≤20 字）</label>' +
      '<input class="ctl" id="dName" maxlength="20" placeholder="仅字典管理配置功能可录入"></div>' +
      selectField('来源', 'd-src', dict('dictSource'), '用户自定义') +
      '<div class="notice notice-warn">此处输入仅用于「新增选项」，不属于项目输入字段；新增后该项会出现在项目表单的选择控件中，并登记字典版本 ' + esc(state.dictVersion) + ' 与创建时间。</div>',
      '<button class="btn" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="dict-save">保存并升级字典版本</button>');
    m.querySelector('[data-act="dict-save"]').addEventListener('click', function () {
      var label = $('[data-field="d-key"]', m).value;
      var key = keys.filter(function (k) { return DICT_LABEL[k] === label; })[0];
      var val = $('#dName', m).value.trim();
      if (!val) { toast('请填写选项名称', 'err'); return; }
      if (dict(key).indexOf(val) >= 0) { toast('该选项已存在', 'err'); return; }
      if (!state.customDict[key]) state.customDict[key] = [];
      state.customDict[key].push(val);
      var parts = state.dictVersion.split('.'); parts[2] = String(Number(parts[2]) + 1);
      state.dictVersion = parts.join('.');
      addChange(P(), 'config_change', 'N00', '字典新增选项：' + label + ' / ' + val + '（字典 v' + state.dictVersion + '）', '参数调整', 'user');
      save(); m.remove(); go('dict');
      toast('字典项已新增，字典版本升至 v' + state.dictVersion, 'ok');
    });
  }

  /* ============ 事件委托 ============ */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) {
      var card = e.target.closest('.proj-card');
      if (card) { state.currentProjectId = card.dataset.project; save(); render(); toast('已切换项目'); }
      return;
    }
    var act = t.dataset.act, p = P(), id = p.currentNode;
    if (runState && (act === 'reset-data' || act === 'remove-asset' || act === 'new-project' || act === 'confirm-yes')) {
      toast('执行进行中，请等待完成后再操作', 'err'); return;
    }
    switch (act) {
      case 'close-modal': closeModal(); break;
      case 'goto': go(t.dataset.view); break;
      case 'new-project': newProjectWizard(); break;
      case 'open-node': p.currentNode = t.dataset.node; save(); go('node'); break;
      case 'file-menu': openFileMenu(p, Number(t.dataset.idx)); break;
      case 'file-open': requestFileOpen(p, t.dataset.rel || '', t.dataset.mode || 'default'); break;
      case 'prev-node':
      case 'next-node':
      case 'jump-node': switchNode(t.dataset.node); break;
      case 'asset-tab': state.assetTab = t.dataset.tab; renderAssets(); break;
      case 'new-asset': assetCreateModal(); break;
      case 'remove-asset': {
        var outKey = String(t.dataset.out || '');
        var outList = p.nodes[id].outputs || [];
        var outItem = outList.filter(function (x) { return String(x.id || x.diskName) === outKey; })[0];
        if (!outItem) { toast('未找到该登记项', 'err'); break; }
        var doRemove = function () {
          p.nodes[id].outputs = outList.filter(function (x) { return String(x.id || x.diskName) !== outKey; });
          p.assets = p.assets.filter(function (a) { return a.id !== outItem.assetId && a.diskName !== outItem.diskName; });
          addChange(p, 'remove_asset', id, '移除素材登记（磁盘文件未删除）：' + outItem.diskName, '参数调整', 'user');
          save(); renderNode(); toast('已移除登记项（磁盘文件未删除）', 'ok');
        };
        /* 删除类动作一律强制人工确认（Q06 / 安全红线），与权限档无关 */
        confirmModal('移除素材登记 · 二次确认',
          '<b>影响范围：</b>仅移除本节点与资产库中的 1 条登记记录 <span class="mono">' + esc(outItem.diskName) + '</span>。<br>' +
          '<b>不删除任何磁盘文件</b>（Q06）；本原型本就没有保存文件本体。<br>' +
          '<b>留痕：</b>写入一条 <span class="mono">remove_asset</span> 变更记录。<br>' +
          '<b>可逆性：</b>不可自动恢复，需重新选择文件登记。',
          doRemove, true);
        break;
      }
      case 'asset-detail': assetDetail(t.dataset.asset); break;
      case 'ref-asset': {
        var x = findAsset(t.dataset.asset);
        if (x) {
          x.a.refs += 1;
          p.nodes[id].outputs = (p.nodes[id].outputs || []).concat([{ name: x.a.name, diskName: x.a.diskName, ext: x.a.diskName.split('.').pop() }]);
          addChange(p, 'create', id, '从资产库引用 ' + x.a.name + '（只读引用，不复制）', '参数调整', 'user');
          save(); closeModal(); go('node'); toast('已引用资产（只读引用，引用计数 +1）', 'ok');
        }
        break;
      }
      case 'pick-asset': go('assets'); toast('在资产库点开资产，选择「引用到当前项目」'); break;
      case 'show-snapshot': modal('输入快照（只读）', '<div class="code-block">' + esc(JSON.stringify({
        themeId: themeId(p.theme), theme: p.theme, spec: p.spec, pixel: pixel(p),
        title: p.name, titleMode: p.titleMode, description: p.description,
        descriptionLength: charLen(p.description), node: id, at: timeStr()
      }, null, 2)) + '</div>', '<button class="btn" data-act="close-modal">关闭</button>', true); break;
      case 'edit-title': editTitleModal(); break;
      case 'edit-description': editDescriptionModal(); break;
      case 'adopt-title': {
        var title = $('#titleAdopt').value;
        addChange(p, 'update', id, '采纳系统建议标题：' + title, '需求变更', 'user');
        save(); toast('已采纳标题：' + title, 'ok'); break;
      }
      case 'save-prompt': {
        var vs = promptVersions(p, id), text = $('#promptEditor').value;
        if (text === vs[vs.length - 1].text) { toast('内容未变化，未生成新版本', 'err'); return; }
        vs.push({ v: vs.length + 1, text: text, ts: timeStr(), by: 'user' });
        addChange(p, 'update', id, '提示词另存为 v' + vs.length + '（保留原文与逐字 diff）', '需求变更', 'user');
        state.promptDirty = false;
        save(); renderNode(); toast('已另存为提示词 v' + vs.length, 'ok'); break;
      }
      case 'diff-prompt': {
        var v = promptVersions(p, id);
        if (v.length < 2) { modal('版本对比', '<div class="notice notice-info">当前仅有 1 个版本。编辑提示词并「另存为新版本」后即可查看逐字差异。</div>', '<button class="btn" data-act="close-modal">关闭</button>'); return; }
        modal('提示词版本对比 v' + (v.length - 1) + ' → v' + v.length,
          '<div class="diff-box">' + simpleDiff(v[v.length - 2].text, v[v.length - 1].text) + '</div>',
          '<button class="btn" data-act="close-modal">关闭</button>', true);
        break;
      }
      case 'copy-prompt': {
        var ta = $('#promptEditor');
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { toast('已复制提示词', 'ok'); });
        else toast('浏览器不支持剪贴板，请手动选中复制', 'err');
        break;
      }
      case 'run-free': startRun(p, id, 'free'); break;
      case 'run-billable': {
        var bcm = p.billingConfirm || { mode: 'always' };
        var goBill = function () { startRun(p, id, 'billable'); };
        if (bcm.mode === 'project-once') {
          addChange(p, 'confirm', id, '按本项目设置跳过计费确认（用户已授权）：' + NODE_META[id].tool, '合规要求', 'user');
          goBill();
        } else {
          confirmModal('计费能力需人工确认（Q04）',
            '<b>影响范围：</b>节点 ' + id + ' 将调用 ' + esc(NODE_META[id].tool) + '，属于计费生成动作。<br>' +
            '<b>成本：</b>估算 50–100 积分，<b>实际扣费未经核实</b>。<br>' +
            '<b>本次实际动作：</b>生成 WorkBuddy 桥接任务包（真实落盘 <span class="mono">data/tasks/</span>）+ 登记调用记录；<b>本地服务不调用模型、不消耗积分</b>。<br>' +
            '<b>后续：</b>任务包由 WorkBuddy 会话读取后用真实模型执行，产物回写项目目录。<br>' +
            '<b>可逆性：</b>任务包与新增文件可删；真实积分消耗不可逆。',
            goBill, true);
        }
        break;
      }
      case 'invoke-wanx': {
        var rt = (p.config && p.config.modelRoute && p.config.modelRoute.image) || {};
        var directPid = (rt.model || '').split('::')[0];
        if (directPid !== 'mp_wanx') { toast('直连仅支持通义万相（mp_wanx）；请在左侧「模型与协作」先选择通义万相模型', 'err'); break; }
        var dmodel = (rt.model || '').split('::')[1] || 'wanx2.6-image';
        var dprompt = (($('#promptEditor') || {}).value) || '';
        var dsize = sizeForSpec(p.spec);
        confirmModal('确认真实调用通义万相生图（消耗额度）',
          '<b>节点 N04</b> 将<b>真实调用</b>通义万相 API 生成 1 张分镜图，<b>消耗阿里云额度（按张计费，约 ¥0.20/张）</b>。<br>' +
          '产物以 PNG 落地到项目目录 <span class="mono">v1/03_asset/image/</span>。<br>' +
          '模型：<span class="mono">' + esc(dmodel) + '</span> · 尺寸：<span class="mono">' + esc(dsize) + '</span><br>' +
          '<b>可逆性：</b>生成扣费不可逆；落盘文件可删。',
          function () { invokeWanxDirect(p, id, dmodel, dsize, dprompt); }, true);
        break;
      }
      case 'confirm-archive': {
        p.nodes[id].status = '已通过';
        addChange(p, 'confirm', id, '人工确认归档（随附旧 N12）：交付包已归位', '需求变更', 'user');
        if (id === 'N08') p.currentNode = 'N08';
        save(); renderNode(); toast('已确认归档（旧 N12 随附，人工确认）', 'ok'); break;
      }
      case 'export-node': exportBundle(true); break;
      case 'confirm-pass': {
        var nd = p.nodes[id];
        var outCount = (nd.outputs || []).length;
        var needForce = !nd.lastRun && outCount === 0;
        var doPass = function (forced) {
          nd.status = '已通过';
          addChange(p, 'confirm', id,
            '结果确认通过：' + defName(id) + (forced ? '（强制通过：尚无产物、未执行，按演示流程放行）' : ''),
            forced ? '其他' : '需求变更', 'user');
          var ix = NODE_DEFS.findIndex(function (d) { return d[0] === id; });
          if (ix >= 0 && ix < NODE_DEFS.length - 1) {
            var nx = NODE_DEFS[ix + 1][0];
            if (p.nodes[nx].status === '未开始') { p.nodes[nx].status = '待输入'; p.currentNode = nx; }
          }
          save(); renderNode(); toast(forced ? '已强制通过（变更记录已留痕）' : '已通过，下游节点已解锁', 'ok');
        };
        if (needForce) {
          confirmModal('本节点尚无产物（通过闸门）',
            '<b>影响范围：</b>节点 ' + esc(id) + ' ' + esc(defName(id)) + ' 尚未执行登记，也没有可检查的登记产物。<br>' +
            '<b>含义：</b>当前原型不生成真实文件，此处「通过」仅表示按演示流程放行，<b>不代表质量验收已完成</b>。<br>' +
            '<b>留痕：</b>确认后写一条带原因码「其他」的变更记录。<br><b>可逆性：</b>可用「返工」回退状态。',
            function () { doPass(true); }, true);
        } else doPass(false);
        break;
      }
      case 'confirm-rework': {
        var reason = $('[data-field="reworkReason"]') ? $('[data-field="reworkReason"]').value : '其他';
        p.nodes[id].status = '返工中'; p.nodes[id].runs = (p.nodes[id].runs || 1) + 1;
        addChange(p, 'reject', id, '结果返工：' + reason, reason, 'user');
        var ix = NODE_DEFS.findIndex(function (d) { return d[0] === id; });
        NODE_DEFS.slice(ix + 1).forEach(function (d) { p.nodes[d[0]].status = '未开始'; });
        save(); renderNode(); toast('已标记返工，下游回到「未开始」（旧文件保留）', 'ok'); break;
      }
      case 'confirm-skip': {
        p.nodes[id].status = '已跳过';
        addChange(p, 'update', id, '节点跳过：' + defName(id), '参数调整', 'user');
        save(); renderNode(); toast('节点已跳过', 'ok'); break;
      }
      case 'cl-diff': {
        var c = p.changelog.filter(function (x) { return x.id === t.dataset.id; })[0];
        modal('变更详情 #' + (c ? c.seq : '-'),
          c ? '<div class="diff-box">' + esc(JSON.stringify({ seq: c.seq, ts: c.ts, actor: c.actor, action: c.action, node: c.node, before: null, after: c.summary, reason_code: c.reason }, null, 2)) + '</div>' : '',
          '<button class="btn" data-act="close-modal">关闭</button>');
        break;
      }
      case 'cl-archive': {
        var ca = p.changelog.filter(function (x) { return x.id === t.dataset.id; })[0];
        if (ca) { ca.archived = true; addChange(p, 'archive', ca.node, '归档变更记录 #' + ca.seq, '参数调整', 'user'); save(); renderChangelog(); toast('记录已归档（仍可查）', 'ok'); }
        break;
      }
      case 'cl-delete': {
        var cd = p.changelog.filter(function (x) { return x.id === t.dataset.id; })[0];
        if (!cd) return;
        confirmModal('删除变更记录（不可逆 · Q19/R3）',
          '<b>影响范围：</b>将删除 #' + cd.seq + ' 「' + esc(cd.summary) + '」。<br><b>风险：</b>删除后该段追溯链出现缺口，不可恢复。<br><b>留痕：</b>系统会自动追加一条 delete_register 审计摘要（只保留 seq / id / ts / hash）。',
          function () {
            var idx = p.changelog.indexOf(cd);
            p.changelog.splice(idx, 1);
            var audit = mkChange('delete_register', cd.node, '审计摘要：已删除 #' + cd.seq + '（' + cd.ts + '）', '参数调整', 'user');
            audit.audit = true; audit.seq = p.changelog.length + 1;
            p.changelog.push(audit);
            save(); renderChangelog(); toast('已删除，并写入 delete_register 审计摘要', 'ok');
          }, true);
        break;
      }
      case 'save-config': {
        var c2 = CFG();
        c2.concurrency = $('[data-field="cfg-concurrency"]').value;
        c2.timeoutTier = $('[data-field="cfg-timeout"]').value;
        c2.renderTier = $('[data-field="cfg-tier"]').value;
        c2.allowBillable = $('#cfgBillable').checked;
        c2.qcItems = $$('[data-chip="cfg-qc"].on').map(function (b) { return b.dataset.val; });
        addChange(p, 'config_change', 'N00', '保存调用配置（并发 / 超时 / 档位 / 计费开关 / 质检项）', '参数调整', 'user');
        save(); toast('配置已保存', 'ok'); break;
      }
      case 'retry-minus': CFG().retry = Math.max(0, CFG().retry - 1); $('#retryVal').textContent = CFG().retry; save(); break;
      case 'retry-plus': CFG().retry = Math.min(5, CFG().retry + 1); $('#retryVal').textContent = CFG().retry; save(); break;
      case 'save-settings': {
        CFG().namingTemplate = $('[data-field="set-naming"]').value;
        CFG().versionPolicy = $('[data-field="set-version"]').value;
        $$('[data-node-switch]').forEach(function (s) { CFG().nodeEnabled[s.dataset.nodeSwitch] = s.checked; });
        addChange(p, 'config_change', 'N00', '保存项目设置（命名模板 / 版本策略 / 节点开关）', '参数调整', 'user');
        save(); toast('设置已保存', 'ok'); break;
      }
      case 'copy-path': {
        if (navigator.clipboard) navigator.clipboard.writeText(p.workDir).then(function () { toast('路径已复制', 'ok'); });
        else toast('请手动复制路径', 'err');
        break;
      }
      case 'copy-diskname': {
        var dn = t.dataset.name || '';
        if (navigator.clipboard) navigator.clipboard.writeText(dn).then(function () { toast('磁盘名已复制', 'ok'); }).catch(function () { toast('复制失败，请手动选中', 'err'); });
        else toast('浏览器不支持剪贴板，请手动复制', 'err');
        break;
      }
      case 'pick-dir': toast('原型不打开系统目录选择器；实际版本将用系统控件（禁止手输路径 Q05）', ''); break;
      case 'reset-data': {
        confirmModal('重置演示数据', '将清空浏览器本地的所有演示项目、变更记录与自定义字典项，恢复为初始 3 个项目。此操作不可逆，但不影响磁盘上的任何真实文件。',
          function () { resetData(true); go('projects'); }, true);
        break;
      }
      case 'svc-check':
        checkService().then(function (ok) {
          return loadScanSummary().then(function () {
            return loadRealProjects().then(function () {
              return loadModelState().then(function () {
                render(); toast(ok ? '本地服务已连接' : '本地服务未连接', ok ? 'ok' : 'err');
              });
            });
          });
        });
        break;
      case 'scan-view': {
        if (!scanSummary) { toast('尚未生成扫描索引，请先点「检测服务」', 'err'); break; }
        var cats = {};
        scanSummary.files.forEach(function (f) { cats[f.category] = (cats[f.category] || 0) + 1; });
        modal('只读扫描索引（蓝本目录）',
          '<div class="notice notice-info" style="margin-bottom:12px">来源 <span class="mono">' + esc(scanSummary.source) + '</span> · 共 ' + scanSummary.total + ' 文件 / ' + (scanSummary.totalBytes / 1024 / 1024).toFixed(1) + ' MB · <b>只读，未写入蓝本目录</b></div>' +
          '<div class="field-label">分类统计</div><div class="enum-out">' + Object.keys(cats).map(function (k) { return esc(k) + '：' + cats[k]; }).join('<br>') + '</div>' +
          '<div class="field-label" style="margin-top:14px">前 20 条（相对路径 / 大小 / 分类）</div>' +
          '<div class="code-block">' + esc(scanSummary.files.slice(0, 20).map(function (f) { return f.rel + '  |  ' + f.size + ' B  |  ' + f.category; }).join('\n')) + '</div>',
          '<button class="btn" data-act="close-modal">关闭</button>', true);
        break;
      }
      case 'backup-export': exportLocalBackup(); break;
      case 'env-probe': {
        api('GET', '/api/env/probe').then(function (r) {
          if (r.status !== 200) { toast('探测失败：' + (r.body.error || r.status), 'err'); return; }
          var j = r.body;
          function toolRow(k, v) {
            return '<tr><td>' + esc(k) + '</td><td>' +
              (v.available ? '<span class="badge s-ok">可用</span> ' + esc(v.versionLine || '')
                : '<span class="badge s-idle">不可用</span> ' + esc(v.reason || '')) + '</td></tr>';
          }
          modal('本机能力与资源探测（只读）',
            '<div class="notice notice-info" style="margin-bottom:14px">' + esc(j.note) + '<br>探测时间：' + esc(j.probedAt) + ' · 写入文件数：' + j.wroteFiles + '</div>' +
            '<table class="tbl"><thead><tr><th>项</th><th>结果</th></tr></thead><tbody>' +
            '<tr><td>Node</td><td>' + esc(j.runtime.node) + ' / ' + esc(j.runtime.platform) + ' ' + esc(j.runtime.arch) + '</td></tr>' +
            toolRow('ffmpeg', j.tools.ffmpeg) + toolRow('ffprobe', j.tools.ffprobe) +
            '<tr><td>真实项目目录</td><td>' + j.workspace.projectCount + ' 个</td></tr>' +
            '<tr><td>只读扫描索引</td><td>' + (j.workspace.scanIndexExists ? '已生成' : '未生成') + '</td></tr>' +
            '<tr><td>蓝本字体文件</td><td>' + j.blueprint.fontFiles.length + ' 个（只读引用）</td></tr>' +
            '<tr><td>线上业务数据</td><td>' + esc(j.onlineBusinessData) + '</td></tr>' +
            '</tbody></table>',
            '<button class="btn" data-act="close-modal">关闭</button>', true);
        }).catch(function () { toast('本地服务未响应', 'err'); });
        break;
      }
      case 'ensure-realdir': {
        var pr = P();
        if (realDirFor(pr)) { toast('当前项目已有真实目录', 'ok'); break; }
        if (!serviceOnline) { toast('本地服务未连接，无法创建真实目录', 'err'); break; }
        withWriteConfirm(pr, '创建当前项目真实目录',
          '<b>影响范围：</b>将在 <span class="mono">projects/' + esc(pr.id + '_' + pr.code) + '/</span> 新建 1 个项目目录、约 33 个 §6.2 三层子目录与 4 个 JSON 元数据文件。<br>' +
          '<b>不覆盖</b>任何既有文件（同名目录会拒绝）。<br><b>可逆性：</b>新增内容可删。<br><b>线上数据：</b>零写入。',
          function (confirmed) {
            api('POST', '/api/project', {
              id: pr.id, code: pr.code, name: pr.name, type: pr.type, titleMode: pr.titleMode,
              description: pr.description, permissionLevel: pr.permissionLevel, confirmed: !!confirmed
            }).then(function (r) {
              if (r.status === 201) {
                pr.realDir = r.body.dir;
                addChange(pr, 'create', 'N00', '创建真实项目目录：' + r.body.dir, '需求变更', 'workbuddy');
                save();
                loadRealProjects().then(function () { render(); toast('已创建真实目录，素材与提示词可落盘', 'ok'); });
              } else if (r.status === 403 && r.body.needConfirm) {
                toast('权限档 3 需要二次确认后重试', 'err');
              } else toast('创建失败：' + (r.body.error || r.status), 'err');
            }).catch(function () { toast('服务未响应', 'err'); });
          });
        break;
      }
      case 'write-workdir': {
        var pw = P(), dirw = realDirFor(pw);
        if (!dirw) { toast('当前项目尚无真实目录，请先到「项目设置 → 数据接入」创建', 'err'); break; }
        var promptText = $('#promptEditor') ? $('#promptEditor').value : currentPromptText();
        var snapshot = JSON.stringify({
          themeId: themeId(pw.theme), theme: pw.theme, spec: pw.spec, pixel: pixel(pw),
          description: pw.description, node: pw.currentNode, at: timeStr()
        }, null, 2);
        var doWrite = function (confirmed) {
          Promise.all([
            api('POST', '/api/node/materialize', { projectId: pw.id, nodeId: pw.currentNode, kind: 'prompt', content: promptText, confirmed: !!confirmed }),
            api('POST', '/api/node/materialize', { projectId: pw.id, nodeId: pw.currentNode, kind: 'snapshot', content: snapshot, confirmed: !!confirmed })
          ]).then(function (rs) {
            var ok = rs.filter(function (x) { return x.status === 201; }).length;
            addChange(pw, 'create', pw.currentNode, '提示词 / 输入快照写入工作目录：成功 ' + ok + ' / 2（不覆盖）', '参数调整', 'workbuddy');
            save(); toast('已写入 ' + ok + ' 个文件到真实目录（未覆盖）', ok === 2 ? 'ok' : 'err');
            if (state.view === 'node') renderNode();
          }).catch(function () { toast('写入失败', 'err'); });
        };
        withWriteConfirm(pw, '写入提示词与输入快照到工作目录',
          '<b>影响范围：</b>将向 <span class="mono">' + esc(dirw) + '</span> 新增 2 个文件（提示词 .md + 输入快照 .json，按 §6.2 归位）。<br>' +
          '<b>不覆盖、不删除</b>任何既有文件。<br><b>可逆性：</b>新增文件可删。<br><b>线上数据：</b>零写入。',
          doWrite);
        break;
      }
      case 'save-permission': {
        var lv = Number($('[data-field="set-perm"]').value);
        var doSavePerm = function (confirmed) {
          p.permissionLevel = lv;
          addChange(p, 'config_change', 'N00', '数据权限调整为 ' + lv + ' 档', '参数调整', 'user');
          save();
          if (serviceOnline && p.realDir) {
            api('PUT', '/api/project/' + p.id, { permissionLevel: lv, confirmed: confirmed }).then(function (r) {
              toast(r.status === 200 ? '权限档已保存并同步到真实项目' : ('同步失败：' + (r.body.error || r.status)), r.status === 200 ? 'ok' : 'err');
            });
          } else toast('权限档已保存（本项目尚无真实目录）', 'ok');
          render();
        };
        withWriteConfirm(p, '修改数据权限',
          '<b>影响范围：</b>本项目后续所有新增 / 修改 / 删除将按新权限档由服务端校验。<br><b>可逆性：</b>可再次调整。',
          doSavePerm);
        break;
      }
      case 'dict-add': dictAddModal(); break;
      case 'model-refresh': loadModelState().then(function () { render(); toast('模型状态已刷新', 'ok'); }); break;
      case 'sync-receipt': {
        var ps = P(), tid = t.dataset.task;
        var rec = ((modelTasks && modelTasks.tasks) || []).filter(function (x) { return x.id === tid; })[0];
        if (!rec) { toast('未找到任务包', 'err'); break; }
        if (rec.projectId !== ps.id) { toast('该任务包不属于当前项目', 'err'); break; }
        if (!ps.syncedReceipts) ps.syncedReceipts = [];
        if (ps.syncedReceipts.indexOf(tid) >= 0) { toast('该回执已同步过', ''); break; }
        var arts = rec.receiptArtifacts || [];
        if (!arts.length) { toast('回执中没有产物', 'err'); break; }
        var nid = rec.node && ps.nodes[rec.node] ? rec.node : ps.currentNode;
        arts.forEach(function (a) {
          var ext = String(a.name || '').split('.').pop().toLowerCase() || 'bin';
          if (!ps.nodes[nid].outputs) ps.nodes[nid].outputs = [];
          ps.nodes[nid].outputs.push({
            id: uid('OUT'), assetId: null, name: a.name, diskName: a.rel, ext: ext,
            size: a.bytes, ts: timeStr(), kind: a.kind || '产物',
            realRel: a.rel, realBytes: a.bytes, fromReceipt: tid
          });
          var ast = mkAsset(uid('AST'), String(a.name || '产物').replace(/\.[^.]+$/, ''),
            a.kind || '图片', '任务包产物', 'final', a.bytes + ' B', ps.id);
          ast.diskName = a.rel;
          ps.assets.push(ast);
        });
        ps.syncedReceipts.push(tid);
        addChange(ps, 'create', nid, '同步任务包回执：' + tid + '（' + arts.length + ' 个产物，来自 WorkBuddy 会话生成）', '参数调整', 'workbuddy');
        save(); render();
        toast('已同步 ' + arts.length + ' 个产物到 ' + nid + ' 输出区', 'ok');
        break;
      }
      case 'billing-save': {
        var pb = P(), sel = $('[data-field="billing-mode"]');
        if (!sel) break;
        var want = sel.value === '本项目不再提示' ? 'project-once' : 'always';
        var cur = (pb.billingConfirm || {}).mode || 'always';
        if (want === cur) { toast('确认方式未变化', ''); break; }
        var applyBilling = function () {
          pb.billingConfirm = { mode: want, acknowledgedAt: want === 'project-once' ? timeStr() : null };
          addChange(pb, 'config_change', 'N00',
            '计费确认方式变更：' + (want === 'project-once' ? '本项目不再提示' : '每次确认'), '合规要求', 'user');
          save(); render();
          toast('已保存：' + (want === 'project-once' ? '本项目不再提示（仍留痕）' : '每次确认'), 'ok');
        };
        if (want === 'project-once') {
          confirmModal('确认关闭本项目的计费提示',
            '<b>影响范围：</b>仅本项目后续计费动作不再弹确认框。<br>' +
            '<b>仍保留：</b>每次计费写变更记录与 ops.log 审计，可随时切回。<br>' +
            '<b>风险：</b>后续点击计费执行会直接进入流程，请确认本项目由你本人操作。<br><b>线上数据：</b>零写入。',
            applyBilling, true);
        } else applyBilling();
        break;
      }
      /* ===== 模型提供商（自定义配置）===== */
      case 'provider-add': providerFormModal(null); break;
      case 'provider-edit': providerFormModal(t.dataset.id); break;
      case 'provider-delete': {
        var delId = t.dataset.id;
        var dp = (modelProviders || []).filter(function (x) { return x.id === delId; })[0];
        if (!dp) break;
        confirmModal('删除模型提供商',
          '<b>名称：</b>' + esc(dp.name) + '<br><b>影响范围：</b>移除该提供商及其模型选项；已存项目里引用它的路由将回到空选。<br><b>可逆性：</b>删除后需重新添加；不删除任何项目文件。<br><b>线上数据：</b>零写入。',
          function () {
            modelProviders = (modelProviders || []).filter(function (x) { return x.id !== delId; });
            persistProviders();
            toast('已删除提供商：' + dp.name, 'ok');
          }, true);
        break;
      }
      case 'provider-test': {
        var tp = (modelProviders || []).filter(function (x) { return x.id === t.dataset.id; })[0];
        if (!tp) break;
        if (!serviceOnline) { toast('服务离线，无法测试连接', 'err'); break; }
        toast('正在测试连接：' + tp.name + ' …', '');
        api('POST', '/api/model/providers/test', { baseUrl: tp.baseUrl || '', apiKeyEnv: tp.apiKeyEnv || '' })
          .then(function (r) {
            if (r.status !== 200 || !r.body) { toast('测试失败', 'err'); return; }
            var b = r.body;
            var msg = 'Key ' + (b.keyConfigured ? '已配置' : '未配置') + ' · 连接 ' + (b.reachable ? ('可达（' + b.reachError + '）') : ('不可达：' + b.reachError));
            modal('连接测试：' + tp.name,
              '<div class="notice ' + (b.reachable ? 'notice-info' : 'notice-warn') + '">' + msg + '</div>' +
              '<div class="small muted">仅探测 env 是否配置与 Base URL 连通性，不发送、不回显 Key。</div>',
              '<button class="btn btn-primary" data-act="close-modal">知道了</button>');
          })
          .catch(function () { toast('测试请求失败', 'err'); });
        break;
      }
      case 'provider-save': {
        var editId = t.dataset.id || '';
        var name = ($('#provName') || {}).value;
        if (!name || !name.trim()) { toast('请填写名称', 'err'); break; }
        var caps = Array.prototype.slice.call(document.querySelectorAll('input[name="provCap"]:checked')).map(function (c) { return c.value; });
        if (!caps.length) { toast('请至少选择一个能力标签', 'err'); break; }
        var models = ($('#provModels') || {}).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!models.length) { toast('请至少填写一个模型名', 'err'); break; }
        var tags = Array.prototype.slice.call(document.querySelectorAll('input[name="provTag"]:checked')).map(function (c) { return c.value; });
        var tier = ($('#provTier') || {}).value;
        var rec = {
          id: editId || ('mp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
          name: name.trim(),
          type: ($('#provType') || {}).value,
          baseUrl: ($('#provBase') || {}).value.trim(),
          apiKeyEnv: ($('#provKeyEnv') || {}).value.trim(),
          capabilities: caps,
          models: models,
          tier: tier,
          tags: tags,
          note: ($('#provNote') || {}).value.trim()
        };
        if (editId) modelProviders = (modelProviders || []).map(function (x) { return x.id === editId ? rec : x; });
        else modelProviders = (modelProviders || []).concat([rec]);
        closeModal();
        persistProviders();
        toast(editId ? '已更新提供商' : '已新增提供商', 'ok');
        break;
      }
      case 'btn-help': break;
    }
  });
  function defName(id) { var d = NODE_DEFS.filter(function (x) { return x[0] === id; })[0]; return d ? d[1] : id; }

  /* 芯片点击（节点详情 / 配置页） */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (!chip || chip.closest('.modal-mask')) return;
    var key = chip.dataset.chip, val = chip.dataset.val, p = P();
    if (key === 'genre' || key === 'scene' || key === 'selling' || key === 'audience') {
      var arr = p.theme[key] || [];
      var i = arr.indexOf(val);
      if (i >= 0) arr.splice(i, 1); else { if (arr.length >= 2 && key !== 'audience') { toast('该项最多选 2 个（枚举组合约束）', 'err'); return; } arr.push(val); }
      p.theme[key] = arr;
      chip.classList.toggle('on');
      $$('[data-chip-count="' + key + '"]').forEach(function (el) {
        el.textContent = '已选 ' + arr.length + ' / 2';
      });
      addChange(p, 'update', p.currentNode, '修改主题标签 ' + key + ' → ' + (val), '需求变更', 'user');
      save();
      return;
    }
    if (key === 'cfg-qc') {
      chip.classList.toggle('on');
      CFG().qcItems = $$('[data-chip="cfg-qc"].on').map(function (b) { return b.dataset.val; });
      save(); return;
    }
    if (key.indexOf('w-') === 0) return; /* 向导内自行处理 */
  });

  /* 字段变更（节点详情规格包） */
  document.addEventListener('change', function (e) {
    var el = e.target, key = el.dataset.field;
    if (el.dataset.act === 'toggle-criteria') {
      var pc = P(), nc = pc.nodes[pc.currentNode];
      if (!nc.criteriaChecked) nc.criteriaChecked = {};
      nc.criteriaChecked[el.dataset.idx] = el.checked;
      addChange(pc, 'update', pc.currentNode,
        '完成判据自检：' + (el.checked ? '勾选' : '取消') + ' 第 ' + (Number(el.dataset.idx) + 1) + ' 项', '参数调整', 'user');
      save(); renderNode(); return;
    }
    if (el.dataset.modelRoute) {
      var cm = CFG(), sk = el.dataset.modelRoute, kind = el.dataset.kind;
      if (!cm.modelRoute) cm.modelRoute = JSON.parse(JSON.stringify(DEFAULT_CONFIG.modelRoute));
      if (!cm.modelRoute[sk]) cm.modelRoute[sk] = {};
      cm.modelRoute[sk][kind] = el.value;
      addChange(P(), 'config_change', 'N00', '模型路由变更：' + sk + ' / ' + kind + ' → ' + el.value, '参数调整', 'user');
      save(); return;
    }
    if (!key || el.closest('.modal-mask')) return;
    var p = P();
    var map = {
      resolution: ['spec', 'resolution'], aspectRatio: ['spec', 'aspectRatio'], styleFlat: ['spec', 'styleFlat'],
      styleAux: ['spec', 'styleAux'], fps: ['spec', 'fps'], mood: ['theme', 'mood'],
      platform0: ['spec', 'platform'], reworkReason: null
    };
    if (key === 'platform0') { p.spec.platform = [el.value]; }
    else if (map[key]) { p[map[key][0]][map[key][1]] = el.value; }
    else return;
    addChange(p, 'update', p.currentNode, '修改枚举字段 ' + key + ' → ' + el.value, '参数调整', 'user');
    save(); renderNode();
  });

  /* Esc 关闭最上层弹层 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var mk = $('.modal-mask'); if (mk) mk.remove(); }
  });

  /* 顶栏与导航 */
  $('#projectSelect').addEventListener('change', function () {
    state.currentProjectId = this.value; save(); render(); toast('已切换项目');
  });
  $('#nav').addEventListener('click', function (e) {
    var b = e.target.closest('.nav-item'); if (b) go(b.dataset.view);
  });
  $('#btnNewProject').addEventListener('click', newProjectWizard);
  $('#btnExport').addEventListener('click', function () { exportBundle(false); });
  $('#btnMode').addEventListener('click', function () {
    modal('当前运行模式：演示模式',
      '<div class="notice notice-info" style="margin-bottom:14px">当前为<b>需求验证原型 / 演示模式</b>。已接入本地文件真实读写（§6.2）与 WorkBuddy 桥接任务包；<b>未直连真实模型</b>，执行区为模拟流程。</div>' +
      '<table class="tbl"><thead><tr><th>项</th><th>当前状态</th></tr></thead><tbody>' +
      '<tr><td>项目主数据</td><td>浏览器 localStorage（服务在线时另有真实项目目录）</td></tr>' +
      '<tr><td>执行动作</td><td>模拟流程 + 逐步日志；计费确认后生成 WorkBuddy 桥接任务包，<b>不直接调用模型、不消耗积分</b></td></tr>' +
      '<tr><td>素材与提示词</td><td>项目有真实目录时<b>可落盘</b>（§6.2 三层，不覆盖）；无目录时只登记元数据</td></tr>' +
      '<tr><td>线上业务数据</td><td>零接入、零写入（只读红线）</td></tr>' +
      '<tr><td>真实模型直连</td><td>未启用（R3 本地侧已放行）；需官方接口文档或自定义 endpoint，见「模型与协作」</td></tr>' +
      '</tbody></table>',
      '<button class="btn" data-act="close-modal">知道了</button>', true);
  });
  $('#btnHelp').addEventListener('click', function () {
    modal('第一期范围说明（PC 网页端优先）',
      '<div class="notice notice-info" style="margin-bottom:14px">本轮范围变更：由 v1.1 的「移动端优先」调整为 <b>第一期仅做 PC 网页端</b>。桌面打包（Electron）仍在 v1.x，本原型不做。</div>' +
      '<table class="tbl"><thead><tr><th>项</th><th>本期</th></tr></thead><tbody>' +
      '<tr><td>形态</td><td>PC 浏览器网页，最小宽度 1024px，多栏 + 侧边栏常驻</td></tr>' +
      '<tr><td>页面</td><td>P1–P10 + 枚举字典管理（Q09）</td></tr>' +
      '<tr><td>数据</td><td>本地 Node 服务（通道 ②）：只读扫描蓝本 627 文件、按 §6.2 创建真实项目目录、三档权限由服务端强制校验；服务离线时降级为浏览器 localStorage 演示数据</td></tr>' +
      '<tr><td>权限档</td><td>项目创建时选择：1 全部（含删除） / 2 仅读写 / 3 每次写需确认（默认 3）</td></tr>' +
      '<tr><td>输入</td><td>可枚举字段只给选择控件；自由文本白名单 4 类：提示词编辑（Q17）、字典项名称（Q09）、项目标题自定义、创作描述 ≤1000 字</td></tr>' +
      '<tr><td>不做</td><td>真实生成调用、无限画布、拖拽编排、Electron 打包、多人协作、云同步、线上业务数据</td></tr>' +
      '<tr><td>原型边界</td><td>已接入本地文件真实读写与桥接任务包；执行区仍为模拟流程，未直连真实模型、不消耗积分；线上业务数据零接入零写入</td></tr>' +
      '</tbody></table>' +
      '<div class="notice notice-warn mt-16">所有演示数据均为本地 mock，包含蓝本《11.11 前夜，厨房大战》的真实规格；刷新后保留，可在「项目设置 → 重置演示数据」恢复初始状态。</div>',
      '<button class="btn" data-act="close-modal">知道了</button>', true);
  });

  /* 启动：先渲染本地演示数据，再探测本地服务并刷新连接状态 */
  load();
  render();
  checkService().then(function (ok) {
    return loadScanSummary().then(function () {
      return loadRealProjects().then(function () {
        return loadModelState().then(function () {
          render();
          if (ok) toast('已连接本地数据服务（真实数据通道 ②）', 'ok');
        });
      });
    });
  });
})();
