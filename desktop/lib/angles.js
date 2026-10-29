'use strict';
// 出题角度库：从简历、岗位要求和技术栈里认出涉及哪些技术，每次随机抽一组不同的考察角度交给模型，
// 避免每次都问同一批「标准题」。项目题、岗位画像题也各有一组切入角度，每次随机挑几个。

// 每项：匹配关键词（正则）→ 这门技术可以考的角度（大白话描述考察点，不是题目本身）。
const TECH = [
  { name: 'Python', match: /python|fastapi|django|flask|asyncio|pydantic|\bpy\b/i, angles: [
    'GIL 对 CPU 密集和 IO 密集任务的影响，什么时候用多进程、线程、协程',
    'asyncio 事件循环里混进同步阻塞调用会怎样，怎么发现、怎么改',
    '生成器 / 迭代器处理大文件或大批数据时怎么省内存',
    '装饰器和闭包：给函数加重试、限流、缓存时要注意什么（如保留函数签名）',
    '上下文管理器管理连接、锁、临时资源，异常时怎么保证释放',
    '可变默认参数、深浅拷贝、循环引用这类坑在项目里踩过没有',
    '引用计数和垃圾回收：长跑服务内存一直涨怎么排查（tracemalloc、objgraph）',
    '类型标注 + mypy / Pydantic v2 在大项目里怎么用，校验失败怎么处理',
    'dataclass、__slots__、NamedTuple 的取舍',
    '多进程间传数据和共享状态的方式及代价（Queue、共享内存、序列化开销）',
    '性能剖析：cProfile / py-spy / line_profiler 找瓶颈的实际经历',
    '依赖和环境管理（uv / poetry / pip-tools）、锁版本、跨机器复现',
    '异常设计：自定义异常层次、重试与幂等、日志里怎么保留上下文',
    '描述符、元类、__init_subclass__ 这类机制在框架里的用途（偏高级）',
    'concurrent.futures 线程池 / 进程池和 asyncio 混用的方式',
  ] },
  { name: 'FastAPI', match: /fastapi|uvicorn|starlette/i, angles: [
    '依赖注入（Depends）的生命周期，数据库会话怎么按请求创建和关闭',
    'async def 路由里调用同步库会阻塞整个 worker 吗，怎么处理',
    'SSE / StreamingResponse 流式输出时客户端断开怎么感知和清理',
    'lifespan 里初始化模型、连接池等重资源的做法',
    'uvicorn / gunicorn worker 数怎么定，和 CPU、内存、GPU 的关系',
    '中间件做鉴权、限流、请求追踪的实现和顺序问题',
    'Pydantic 模型在请求校验、响应裁剪中的坑（如可选字段、默认值）',
    'BackgroundTasks 和 Celery 之类任务队列的边界',
  ] },
  { name: 'LangChain / LangGraph / Agent', match: /langchain|langgraph|agent|智能体|deepagents|autogen|crewai|function ?calling|tool ?call|react/i, angles: [
    'Agent 的规划、执行、复核怎么拆，单 Agent 和多 Agent 的取舍',
    '工具调用失败、参数错误、超时时的重试和降级',
    'LangGraph 状态设计：哪些放 state、checkpoint 怎么做断点续跑',
    '人工介入（interrupt / 审批）怎么嵌进流程',
    'Agent 死循环、反复调用同一工具怎么发现和止损（步数、预算、去重）',
    '多轮对话记忆：摘要、裁剪、长期记忆的取舍',
    '怎么评测一个 Agent 好不好（任务成功率、成本、轨迹评估）',
    '链路追踪和可观测性（LangSmith / 自建日志），线上问题怎么复盘',
    'Agent 的权限和安全：防提示词注入、限制工具能做的事',
    '框架的抽象什么时候成了负担，有没有绕开框架自己写过',
  ] },
  { name: 'RAG / 检索', match: /rag|检索|召回|知识库|embedding|向量|rerank|hyde|bm25|rrf|milvus|qdrant|faiss|elasticsearch|es\b/i, angles: [
    '文档切分：按语义 / 结构 / 固定长度的取舍，表格和图片怎么处理',
    '稠密 + 稀疏混合检索怎么融合（RRF / 加权），分数怎么对齐',
    'Rerank 放在哪一步、候选数量怎么定、对延迟的影响',
    '怎么评估检索效果：召回率、MRR、命中率，评测集怎么来',
    '答案有幻觉或引用错误时怎么定位是检索还是生成的问题',
    '知识库增量更新、删除和版本管理，索引怎么不停服重建',
    'Embedding 模型怎么选，换模型时历史向量怎么办',
    'HNSW / IVF 等索引参数对召回和速度的影响，带过滤条件的检索',
    '多路召回结果去重和上下文拼装，窗口不够时怎么裁',
    'query 改写、HyDE、多查询扩展的效果和代价',
  ] },
  { name: '大模型应用', match: /llm|大模型|gpt|qwen|glm|deepseek|prompt|提示词|微调|lora|vllm|ollama|推理|模型部署|量化/i, angles: [
    '结构化输出：JSON 解析失败、字段缺失时怎么兜底',
    '提示词的版本管理和回归测试，改一句提示词怎么知道没改坏',
    '上下文窗口管理：长文档、长对话怎么压缩',
    '成本和延迟优化：缓存、小模型分流、批处理、流式',
    '什么时候选微调、什么时候 RAG、什么时候只调提示词',
    'LoRA 微调的数据怎么造、怎么防过拟合、怎么评估',
    '私有化部署：vLLM / Ollama、量化、显存和并发的估算',
    'KV Cache、批处理对吞吐的影响',
    '模型输出的安全审核和敏感信息过滤',
    '线上效果怎么持续评估（离线评测集 + 线上反馈）',
  ] },
  { name: '数据库', match: /mysql|postgres|pgsql|sql\b|数据库|索引|doris|mongodb|clickhouse/i, angles: [
    '慢查询排查：执行计划怎么看，索引为什么没生效',
    '联合索引的顺序和覆盖索引',
    '事务隔离级别和实际遇到的并发问题',
    '大表加字段、改索引怎么不锁表',
    '分库分表或冷热分离的取舍',
    'ORM（SQLAlchemy / MyBatis）生成的 SQL 有什么坑，N+1 问题',
  ] },
  { name: 'Redis / 缓存', match: /redis|缓存|cache/i, angles: [
    '缓存穿透、击穿、雪崩各自怎么防',
    '缓存和数据库的一致性怎么保证',
    '分布式锁的实现和过期时间问题',
    '大 key、热 key 的发现和处理',
  ] },
  { name: '消息队列 / 异步任务', match: /kafka|rabbitmq|rocketmq|celery|消息队列|mq\b|任务队列/i, angles: [
    '消息重复消费怎么做幂等',
    '任务失败重试、死信和告警',
    '消息积压时怎么定位和扩容',
    '长任务的进度汇报、取消和断点续跑',
  ] },
  { name: 'Docker / K8s / 部署', match: /docker|k8s|kubernetes|容器|部署|ci\/cd|jenkins|helm/i, angles: [
    '镜像怎么做小、怎么加速构建',
    'GPU 服务在容器里的部署和资源限制',
    '滚动发布、回滚、健康检查怎么配',
    '线上服务的日志、指标、告警怎么搭',
  ] },
  { name: 'Java / Spring', match: /java\b|spring|jvm|mybatis|微服务/i, angles: [
    'JVM 内存和 GC 问题的排查经历',
    'Spring 事务失效的常见原因',
    '线程池参数怎么定，满了以后怎么办',
    '微服务之间超时、重试、熔断怎么配',
  ] },
  { name: '前端 / 全栈', match: /vue|react\b|typescript|前端|websocket/i, angles: [
    '流式输出在前端怎么渲染、断线怎么重连',
    'WebSocket 和 SSE 的取舍',
    '大列表、长对话的渲染性能',
  ] },
];
// 认不出技术时的通用角度
const GENERIC = ['核心原理', '边界条件和异常情况', '性能瓶颈和扩展', '设计取舍', '线上故障排查', '测试和可观测性'];

// 项目题的切入角度：同一个项目不要每次都按「做了什么 → 怎么做 → 条件变了」一个套路问。
const PROJECT_ANGLES = [
  '整体架构和自己负责的那一块的边界',
  '一个具体技术选型为什么这么选，备选方案是什么',
  '简历里写的某个数字（指标提升、规模、耗时）是怎么测出来的',
  '最难的一个技术问题，当时怎么定位、怎么解决',
  '上线后出过的一次故障或事故，怎么发现、怎么止血、怎么复盘',
  '如果数据量或并发扩大 10 倍，哪里先扛不住',
  '如果让你重做，哪里会做得不一样',
  '和产品 / 业务 / 其他团队意见不一致的一次经历',
  '效果怎么评估，评测集怎么来的',
  '成本（算力、人力、时间）怎么控制',
  '代码层面一个关键模块的实现细节',
  '项目里你主动推动、不是别人安排的一件事',
];

// 打乱后取前 n 个（rand 可注入，便于测试）
function sample(list, n, rand = Math.random) {
  const a = [...list];
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a.slice(0, n);
}

// 这次出题的角度：涉及哪些技术 + 每门技术抽几个角度 + 项目题抽几个切入角度。
function pickAngles({ resume = '', jd = '', skills = '' }, rand = Math.random) {
  const text = `${skills}\n${jd}\n${resume}`;
  const own = `${skills}\n${jd}`;
  // 技术栈 / 岗位要求里点名的技术优先，其次是简历里出现的。
  const hits = TECH.filter((t) => t.match.test(text)).sort((a, b) => Number(b.match.test(own)) - Number(a.match.test(own)));
  const techs = hits.slice(0, 5).map((t, k) => ({ name: t.name, angles: sample(t.angles, k < 2 ? 4 : 2, rand) }));
  return { techs, generic: techs.length ? [] : sample(GENERIC, 4, rand), project: sample(PROJECT_ANGLES, 6, rand) };
}

module.exports = { TECH, PROJECT_ANGLES, pickAngles, sample };
