# Agent 面试工作台

单文件、可离线使用的面试官工作台，围绕用人画像的三个维度组织题目：

| 维度 | 看什么 |
|---|---|
| 专业 `pro` | 技术方向与深度：原理、边界、取舍、失败模式 |
| 表达 `exp` | 能否把项目和方案讲清楚：先结论后细节、指标有口径、分清个人与团队贡献 |
| 应变 `ext` | 条件或方案变化后能否重新推导，并说清为什么 |

## 三个视图

- **通用题池**：原 320 道题全部补充了维度标签、「情景变更」追问、高分信号和风险信号；新增「项目表达与情景应变」等分类，以及从简历专项中去个人化后沉淀的通用题（带「源自简历」标记）。
- **简历专项**：每位候选人按简历分块（专业技能 / 工作经历 / 每个项目），每块按「表达 → 专业 → 应变」出题，附简历核实点、面试策略和本场三维打分（打分只保存在本机浏览器）。
- **评估方法**：用人画像、60 分钟面试流程、1~4 分评分锚点、题卡用法和常见风险信号。

## 目录

```
data/pool/base.json    原始题库（320 题，含参考代码）
data/pool/enrich.json  按题号补充的 dims / twist / good / bad，以及少量措辞优化
data/pool/added.json   新增通用题（含简历沉淀题，origin 字段指向来源题）
private/resumes/       候选人简历专项题（含个人信息，已在 .gitignore 中排除）
src/                   页面模板：shell.html、style.css、app.js、method.html
scripts/build.py       组装成单个 HTML
dist/                  构建产物
```

## 构建

```bash
python3 scripts/build.py            # dist/interview-workbench.html，包含 private/resumes 下的候选人
python3 scripts/build.py --public   # dist/interview-workbench-public.html，只含通用题池
```

候选人数据属于个人信息，不要提交到公开仓库；需要共享时只分发完整版 HTML 文件。
