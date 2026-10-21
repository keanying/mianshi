# 面试助手（桌面版）

上传候选人简历 → 生成大白话面试题和回答要点 → 面试时录音、边录边转文字 → 面试后按 **专业度 / 自驱力 / 性格特质 / 逻辑思维 / 适应力** 五个维度打分（0~5），导出评估报告。

支持 Windows 和 macOS，大模型可选 **智谱 GLM** 或 **DeepSeek**。

## 安装

| 系统 | 文件 | 说明 |
|---|---|---|
| Windows | `interview-assistant-…-win-x64.exe` | 安装版，双击安装 |
| Windows | `interview-assistant-…-win-x64.zip` | 免安装版，解压后双击 `面试助手.exe` |
| macOS | `interview-assistant-…-mac-arm64.dmg`（M 系列芯片）/ `…-mac-x64.dmg`（Intel） | 拖进「应用程序」。首次打开如提示“无法验证开发者”，在「系统设置 → 隐私与安全性」里点「仍要打开」 |

安装包由 GitHub Actions 自动构建：仓库页面 → Actions → 「面试助手桌面版」→ 最新一次运行 → 页面底部 Artifacts 下载。

## 第一次使用：配置模型

打开后会先进入「设置」：

1. **大模型**：选「智谱 GLM」或「DeepSeek」，粘贴 API Key，点「测试连接」。
   - 智谱：在 [open.bigmodel.cn](https://open.bigmodel.cn) 创建 API Key，默认模型 `glm-5`。
   - DeepSeek：在 [platform.deepseek.com](https://platform.deepseek.com) 创建 API Key，默认模型 `deepseek-v4-flash`（旧的 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 下线，旧设置会自动换成新名字）。
   - 模型名可以手动改成账号里可用的任意模型。
   - 「关闭深度思考」默认勾选：请求里带上 `thinking: disabled`，出题和评估更快、更省。不支持关闭思考的模型（如 GLM-5.3）会自动去掉该参数照常调用。
2. **语音转文字**：用智谱 GLM-ASR（默认模型 `glm-asr-2512`）。大模型选智谱时勾选「共用 API Key」即可；选 DeepSeek 时需要另填一个智谱的 Key（DeepSeek 没有语音转文字）。点「测试转写」确认可用。
3. **出题默认值**（可选）：默认岗位、岗位要求、每场题目数量。

## 一场面试怎么用

1. **简历**：点左上「新建面试」，把简历 PDF / TXT 拖进来（扫描件 PDF 读不出文字，可以把内容粘贴到文本框）。填姓名、岗位，可补充岗位要求，点「生成面试题」。
2. **面试题**：按「开场热身 → 简历里每个项目 → 岗位基础题 → 做事方式题」分组，每题都标了考察维度，附回答要点、追问、“听到什么不错 / 听到什么要警惕”。觉得不顺口的题点「换个问法」。
3. **面试中**：点「开始录音」。线上面试戴耳机时，勾选「同时录制电脑声音」才能录到对方（Windows 支持；macOS 视系统版本，不支持时会提示只录了麦克风）。录音每 25 秒转写一段，转写会实时出现在页面上；右侧可以勾选已问的题，下方记现场笔记。
   - 不想录音，也可以在面试后点「导入会议转写」，导入飞书妙记、腾讯会议等导出的文字；或点「编辑全文」直接粘贴。
4. **评估**：点「生成评估」，得到五个维度的分数、理由和候选人原话依据，以及整体结论、优点、风险、下一轮建议追问。分数可以手动调整，然后「导出 PDF」或「导出 Markdown」。

> **录音前请告知候选人并征得同意。** 简历和转写内容会发送给你所选的模型服务商（智谱 / DeepSeek）处理。

## 数据保存在哪里

全部保存在本机，设置页底部可以直接打开数据目录：

- Windows：`%APPDATA%\面试助手\`
- macOS：`~/Library/Application Support/面试助手/`

每场面试一个文件夹，里面有 `interview.json`（简历文字、题目、转写、笔记、评估）、简历原件、`audio/` 录音分段和合并后的 `完整录音.wav`。API Key 用系统钥匙串加密保存。

## 常见问题

| 现象 | 处理 |
|---|---|
| 「API Key 无效」 | 检查 Key 是否复制完整、账户是否有余额 |
| 「接口地址或模型名称不对」 | 恢复服务商默认地址；模型名改成控制台里能看到的名字 |
| 某几段转写失败 | 录音结束后点「重试失败的段」；录音文件已保存，不会丢 |
| 录不到声音 | Windows：设置 → 隐私 → 麦克风，允许桌面应用；macOS：系统设置 → 隐私与安全性 → 麦克风，勾选「面试助手」 |
| PDF 读不出文字 | 多半是扫描件，把简历内容复制粘贴到文本框 |

## 开发

```bash
cd desktop
npm install            # .npmrc 已设置跳过 pdf.js 的可选原生依赖
npm start              # 启动
npm test               # 单元测试
xvfb-run -a node test/e2e.js        # 端到端测试（需要 Playwright；用模拟的模型服务跑完整流程）
npx electron-builder --win          # 打包 Windows（在 Linux 上打包需加 -c.win.signAndEditExecutable=false，且只能出 zip）
npx electron-builder --mac          # 打包 macOS（需在 Mac 上）
```

代码结构：`main.js`（主进程：模型调用、存储、导出）、`preload.js`（安全桥接）、`lib/`（模型、转写、提示词、简历解析、存储、报告）、`src/`（界面与录音）。出题和评估的提示词在 `lib/prompts.js`，“大白话”规则和评分标准都在这里调整。
