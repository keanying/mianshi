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
   - DeepSeek：在 [platform.deepseek.com](https://platform.deepseek.com) 创建 API Key，默认模型 `deepseek-v4-pro`（也可选更便宜的 `deepseek-v4-flash`；旧的 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 下线，旧设置会自动换成新名字）。
   - 模型名可以手动改成账号里可用的任意模型。
   - 「关闭深度思考」默认勾选：请求里带上 `thinking: disabled`，出题和评估更快、更省。不支持关闭思考的模型（如 GLM-5.3）会自动去掉该参数照常调用。
2. **语音转文字**：用智谱 GLM-ASR（默认模型 `glm-asr-2512`）。大模型选智谱时勾选「共用 API Key」即可；选 DeepSeek 时需要另填一个智谱的 Key（DeepSeek 没有语音转文字）。点「测试转写」确认可用。
3. **出题默认值**（可选）：默认岗位、岗位要求、每场题目数量。

## 一场面试怎么用

左上角「＋ 添加候选人」，然后按页面顶部的 5 步走：

1. **候选人**：填姓名、应聘岗位，把简历 PDF / TXT 拖进来（扫描件 PDF 读不出文字，可以把内容粘贴到文本框），有岗位要求的话贴上。点「下一步：调试音频」。
2. **音频调试**：先选面试方式——**面对面**（一个麦克风录下双方）或 **线上（戴耳机）**（你的麦克风记为面试官，会议软件里对方的声音单独录一路记为候选人）。每次进入这一步都重新测试，不沿用上次的结果。
   - 左边「面试官」：选麦克风。音量条和「● 正在说话」只在真的有人说话时才亮（会自动适应背景噪声）。点「开始测试」，读出页面上给的那句话、停一下，就会自动转写，并显示和原句对上了多少（≥ 60% 才算通过；对不上会提示可能录到了别的声音）。
   - 右边「候选人」：先选**播放设备**（你的耳机），点「播放测试音」，听到「嘀」后点「听到了」。线上面试再选候选人的**声音来源**：一般选「电脑声音」（会议软件里对方的声音；录的是系统默认播放设备，请把耳机设为默认）。只有装了虚拟声卡（VB-CABLE、BlackHole）或开了「立体声混音」才需要选其他输入设备；ToDesk、向日葵等远程控制软件的虚拟麦克风不是对方的声音，选了会提示。然后点「**开始测试**」：用智谱 GLM-TTS 把一句样例回答合成出来、从你选的播放设备放出来（合成不可用时用系统语音朗读），从候选人那一路录下来再转写，和原句比对准确率。线上面试时如果你的麦克风也录到了这句话，会提示「串音」：说明没戴耳机，面试时候选人的话会被记两遍。对方已经在会议里时，也可以点「真人测试」。
   - 底部两项都显示 ✓ 后，点「下一步：生成面试题」。设备选择会记住。
3. **面试题**：点「生成面试题」，题目边生成边显示，按「开场热身 → 简历里每个项目 → 岗位基础题 → 做事方式题」分组，每题标了考察维度，附回答要点、追问、“听到什么不错 / 听到什么要警惕”。不顺口的题点「换个问法」。
4. **面试中**：点「**开始面试**」自动开始录音，面试官和候选人的话按说话停顿切段、边说边转写（每段最长 15 秒）。左边是当前题（大字显示要点、追问和判断信号），问完点「✓ 已问，下一题」；右边是转写和现场笔记。
   - **AI 副驾**：你问出准备好的某道题时，会从转写里自动认出来，跳到这题并标为已问；候选人答完（停顿 5 秒、你又开口、或回答很长时），自动对照回答要点打 ✓ / ✗，给一句点评和 1~2 个可以马上追问的问题。也可以随时点「看看答得怎样」。
   - **串音去重**：线上面试没戴耳机时，你的麦克风会录到扬声器里候选人的声音，同一句话出现两遍；系统会自动去掉面试官那一路的重复，并提示戴耳机。
   - 中途插拔耳机（音频设备变化）会马上提醒。
   - **重新开始面试**：清空这场的录音、转写、笔记和报告（简历和面试题保留），从头再来。
   - 面试结束后点转写里的任意一句可以回放那一段录音。
   - 转写失败或当时没录上：在「转写」右上角点「重新转写」，用保存下来的录音整场重转；「打开录音」用系统播放器听完整录音。也可以「导入」飞书妙记、腾讯会议等导出的文字。
5. **评估报告**：点「结束面试」后自动进入这一步：先区分面试官和候选人（面对面录音时），再按五个维度边生成边显示分数、理由和候选人原话依据，以及整体结论、优点、风险、下一轮建议追问。线上面试还会给出「回答节奏」：双方说话时长占比、候选人每次开口前停了多久——每次都停得很久且很一致时会提示（可能在看提示工具，建议多追问细节），仅供参考、不计入打分。分数可以手动调整，然后「导出 PDF」或「导出 Markdown」。

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

## 自己打包

打包要在对应的系统上做：Windows 安装包在 Windows 上打，macOS 安装包在 Mac 上打。

**1. 准备环境（只做一次）**

- 安装 [Node.js 22 LTS](https://nodejs.org/zh-cn)（一路下一步）和 [Git](https://git-scm.com/downloads)。
- 国内网络建议先设置镜像，否则下载 Electron 很慢或失败。

  Windows（PowerShell）：
  ```powershell
  npm config set registry https://registry.npmmirror.com
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
  ```
  macOS（终端）：
  ```bash
  npm config set registry https://registry.npmmirror.com
  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```
  （`$env:` / `export` 只对当前窗口有效，新开窗口要重新执行。）

**2. 下载代码并安装依赖**

```bash
git clone https://github.com/keanying/mianshi.git
cd mianshi/desktop
npm install
npm test          # 可选：跑一遍单元测试，看到 pass 即可
npm start         # 可选：先直接运行看看
```

**3. 打包**

| 系统 | 命令 | 产物（在 `desktop/dist/` 里） |
|---|---|---|
| Windows | `npm run dist:win` | `interview-assistant-<版本>-win-x64.exe`（安装版）和 `…-win-x64.zip`（免安装版） |
| macOS | `npm run dist:mac` | `interview-assistant-<版本>-mac-arm64.dmg`（M 系列芯片）和 `…-mac-x64.dmg`（Intel） |

- 版本号在 `package.json` 的 `version` 字段，改了再打包，安装包文件名会跟着变。
- 安装包没有做代码签名：Windows 首次运行如出现“Windows 已保护你的电脑”，点「更多信息 → 仍要运行」；macOS 见上面「安装」一节。
- 不想在本机装环境：GitHub 仓库 → Actions → 「面试助手桌面版」→ 右侧「Run workflow」，几分钟后在这次运行页面底部的 Artifacts 里下载 Windows 和 macOS 安装包（每次推送 `desktop/` 的改动也会自动打包）。

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
