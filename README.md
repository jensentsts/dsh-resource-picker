# DSH 资源选择器 / Resource picker

> 插件集导航与市场索引：https://github.com/jensentsts/dsh-independent-plugins


独立 Cordis 插件 `@local/dsh-resource-picker`，面向 DSH 0.2.2-rc.1。其他插件通过公开 Client 服务打开 DSH 内部 `shell.overlay` 三栏弹窗：工作区窄栏、会话窄栏及新建按钮、宽预览栏。文件栏可在选中工作区后直接浏览；有会话时沿用官方 `workspaceFiles`，无会话时经注册工作区的官方 `ctx.fs` 公开接口做有界读取，不创建会话或 Agent。它不接管主页、不挂第二个 React app、不读取其他插件 DOM。

**使用入口：**设置 → 选择资源 → 打开资源选择器。此入口打开三栏弹窗；其他插件使用公开 Client 服务。会话目录加载完成后显示会话或空列表，加载期间显示进度。

已在安装中的桌面版显示真实会话目录与原生被动预览，历史模型与推理等级、头像、时间和复制动作均随原生会话呈现。尚未选择会话时，权限 Hook 使用空字符串作为显式空键；这避免将权限动作误作 selector 的比较函数，修复从预览切回工作区后 `isEqual is not a function` 导致的弹窗关闭。对应检查使用同版本真实 keyed Hook，覆盖切回工作区和重新打开窗口。

## 消费者 API v1

完整类型在 `types.d.ts`。运行时代码不需要 import 此包：用 Cordis 可选服务注入，服务随卸载消失。不要查询 DOM，也不要用全局变量找选择器。

```js
ctx.inject(['resourcePicker'], pickerCtx => {
  const picker = pickerCtx.resourcePicker;
  // 在明确的用户按钮事件中调用：
  async function chooseBinding(signal) {
    if (picker.version !== 1 || !picker.capabilities().overlay) return;
    const result = await picker.open({
      allowedTypes: ['session'],
      multiple: false,
      workspaceId: existingWorkspaceId,
      sessionId: existingSessionId, // 只决定浏览位置，不算已选择
      initialSelection: [],
      allowCreateSession: true,
      agentPreset: 'your-preset', // 仅用于点“新建”
      selectModel: true,
      modelSelection: { provider: 'provider-id', model: 'model-id' },
    }, { signal });
    if (result.status !== 'selected') return; // 取消、abort、卸载不是授权
    // 这里再调用消费插件自己的 Host 保存操作；picker 不保存绑定。
    await saveBinding(result.items[0], result.modelSelection);
  }
});
```

`open(options?, {signal}?)` 返回：

- `{status:'selected',items:Resource[],modelSelection?}`：必须明确点击“选择”；Host 重验类型、数量、workspace/session 归属、文件类型/包含关系及可选模型与 effort。
- `{status:'cancelled',reason:'user'|'aborted'|'disposed'}`：不产生选择或绑定保存；非法参数拒绝 Promise。

资源种类：

```ts
{type:'workspace',workspaceId,title,path}
{type:'session',workspaceId,sessionId,title,agentPreset?}
{type:'file',workspaceId,sessionId?,path,name} // path相对工作区；省略sessionId时经注册工作区的官方fs读取
```

ID 是定位权威，标题仅显示。最终结果使用 Host 当前名称与 preset，不相信调用方传入标签。文件去重使用 `workspaceId + path`，不会因换一个会话读取同一文件而重复。

### 选项与默认值

| 字段 | 默认 / 行为 |
|---|---|
| `allowedTypes` | `['workspace','session','file']`；不可空 |
| `multiple` | `false` |
| `allowMixed` | `false`；多选异类型须显式开启 |
| `allowParentChild` | `false`；workspace 与其 session/file、session 与其 file 并选须开启 |
| `maxSelections` | 多选 100，单选 1；有效范围 1–100 |
| `workspaceId/sessionId` | 初始浏览位置，不选择、不新建、不导航 |
| `initialSelection` | 空；受同一规则约束，最终再次 Host 校验 |
| `allowCreateSession` | `false`；开启后才显示显式新建按钮（仍受官方 UI access hooks 限制） |
| `agentPreset` | 新建时传给官方 session controller，不修改已存在会话 |
| `selectModel` | `false`；开启后显示实时官方 model catalog 与 effort |
| `modelSelection` | 未提供时显示 catalog 默认；仅回传建议，不调用 `selectModel`，不改全局默认 |
| `title` | 全局 locale 的选择资源标题 |
| `commandSessionId` | 兼容保留，v1 忽略；不为预览激活命令会话 |

同一 Client 最多排队 32 个请求，FIFO 一次一个弹窗。关闭、调用方 abort、插件卸载与 overlay declaration collapse 都会结算请求并移除监听器，不自动接受排队项。调用方必须取消不再需要的请求。

`capabilities()` 返回 `{overlay,nativeChatPreview,nativeFilePicker:false,workspaceFiles,createSession}`；`nativeChatPreview` 取决于当前组合是否注册 `conversation.preview` Factory。它描述当前组合可达的能力，不是权限批准或最终成功保证；每个操作仍可能失败。无服务或 `overlay:false` 时应禁用入口并说明缺少插件，不能悄悄切成 OS 窗口。

## 官方复用与明确降级

- 工作区与会话列表来自官方 `useWorkspaces`、`useSessions`；不复制私有 sidebar 组件、不轮询数据库。
- 文件树优先 `renderFactorySlot('sidebar.files.tree', FileTreeInput)`：使用官方公开 FileTree、图标及交互。目录按工作区根逐级浏览，`onOpen` 只预览；右侧复选框是选择动作。factory 不在组合时才使用本包列表 fallback。有会话时列表来自官方 `workspaceFiles`；无会话时列表来自本包对注册工作区的有界 `fs.listDir` 读取。
- **文件选择仍不是 native file chooser。** 0.2.2-rc.1 暂无已确认的、返回任意文件选择结果的公开 DSH chooser seam。这里只用 DSH 内部文件浏览器，不调用 OS dialog。有会话时文本预览经官方 `workspaceFiles.read`；无会话时经注册工作区的官方 `ctx.fs` 公开 `listDir/readBytes/readByteRange` 做有界目录与文本读取，不创建会话或 Agent。选中工作区即可进入文件栏，不再要求先有会话。
- 会话预览优先调用唯一公开原生 `conversation.preview` Factory，传入 `{sessionId,readOnly:true}`；底座以独立被动读取租约复用原生标题与 Chat 正文，保持推理、工具、媒体及更早历史读取，不导航主视图、不创建输入状态、不发送消息。Factory 不在组合时才显示明确标注的文本 fallback：官方 `sessionController.events` 经 `sessionQuery` 冷读取，仅显示合法 user/assistant text 与媒体名称。两条读取路径均不为预览创建或激活 Agent，本包不复制私有 Chat renderer。
- 新建按钮独立调用官方 session controller，创建持久空白普通会话，不发 prompt、不调用模型、不调高权限。**创建后再取消选择会保留空会话**，UI 明示，不擅自删除持久数据。
- 文件 path 必须工作区相对、无 `..`/drive/absolute；官方 `fs.resolve/contains/stat` 复核 symlink identity 与真实包含关系。有会话时再走 `workspaceFiles.list/read`，其文件 scope 的 `workspaceRoot` 固定为选中工作区路径，不受 Session 当前 cwd 漂移影响；无会话时在同一 `fileTarget` 结果上走 `fs.listDir/readBytes/readByteRange`。

## Host 操作与权限

Host 服务 `ctx.resourcePickerHost.execute(request, signal?)` 是可信进程内调用接口；使用方本身必须拥有原操作权限。公开 wire namespace 为 `remote.resourcePicker.execute`，严格 descriptor/codec 在同包注册，所有 wire 调用由 service 本体 **owner-only fail-closed**：非 owner、缺 principal 或失效身份拒绝，不能借返回的 ID 扩权。进程内 `ctx.invocation === undefined` 是可信插件调用，按 Cordis 信任模型允许；不能把该接口再次无条件转发给外部网络。

同一业务实现提供 `catalog/models/preview/validate/create-session/files/file-preview`。预览与选择永不调用模型设置接口。总体请求上限 128 KiB，完整响应 JSON（含 wrappers/labels/media）上限 512 KiB，过大返回显式 `result-too-large`，不静默截丢目录或 catalog。文本预览最多 40 条 / 48k chars、每条最多 8 个媒体名称；有会话的文件文本最多 120 行 / 32k chars，无会话的 `fs` 预览最多 128 KiB / 32k chars；界面说明截断与更早页。

人类命令 `/resource-picker <JSON>` 和延迟发现工具 `resource_picker_read` 都调用同一操作实现，但仅允许当前 Agent 的 session 预览或 reference 校验。它们拒绝跨会话、catalog、创建、model catalog 及文件操作，避免将只对接收会话鉴权的 command 转成跨资源/根文件权限。文件操作请使用 Agent 原有 filesystem 工具。不会通过工具批准、授予或扩大权限。

示例（当前会话）：

```text
/resource-picker {"action":"preview","workspaceId":"<full-workspace-id>","sessionId":"<current-session-id>"}
```

## 独立分发

- `cordis.patch.yml` 只插入本包 entry，**不修改任何其他插件或 profile**。
- 英/中元数据和界面文案走宿主 locale，其他语言按宿主 fallback，不另设语言开关。
- 原创三栏图标，MIT；无需打包 React 副本或 CDN。
- Host 用 Cordis Service；Client 用动态 module-loader factory，React 与 Zod 来自宿主模块表；Zod 为真实严格 schema，支持 JSON Schema inspection，不使用仿造 parse 对象。Host RPC、Client RPC 挂载、locale、resource provider、slot、服务和请求均随所属 fiber 清理。
- 不安装脚本、不自更新、不外发、不写配置或 sidecar。消费插件保存自己的绑定，选择器不耦合 QQ/remote/reference 包。

## 构建与测试

在包目录用 Node 24.9+，不需要安装依赖即可重新生成动态 Client：

```powershell
node build.mjs
node build.mjs --check
node --check index.js
node --check client.js
node --test tests/*.test.mjs
```

可选的已编译 Client 语义 DOM 测试使用 exact-release 已存在依赖，不安装、不运行 GUI server：

```powershell
$env:DSH_SOURCE_ROOT = '<exact 0.2.2-rc.1 source root>'
node --test tests/*.test.mjs
```

未设置 `DSH_SOURCE_ROOT` 的普通测试明确跳过 DOM lane；不应把跳过写成通过。真实 Cordis/Gateway lane使用本包 test-only loader 转译 exact-release 源码并复用其已有依赖，不生成外部构建产物：

```powershell
$env:DSH_SOURCE_ROOT = '<exact 0.2.2-rc.1 source root>'
node --import ./tests/runtime-loader.mjs --test tests/runtime.integration.mjs
```

该 lane验证真正 Cordis service/严格 Typert Gateway 的 owner、已获global role的非owner及缺principal拒绝、可信Host进程内调用、卸载撤销 service/descriptor/tool/command 与旧endpoint不降级。外部业务服务被mock，不创建真实会话、不打开网络端口。它不是已安装 profile 或视觉验证。

官方 Loader/Include 的真实文件组合测试另行运行（不是手工挂载被测插件）：

```powershell
$env:DSH_SOURCE_ROOT = '<exact 0.2.2-rc.1 source root>'
node --expose-internals --import ./tests/runtime-loader.mjs --test tests/loader.integration.mjs
```

`tests/fixtures/cordis.yml` 挂真实 TypertRegistry、RemoteAccess、Gateway 和本包，仅工作区/会话数据源为外部 mock。测试断言每个官方 entry ACTIVE、owner 与获global role guest行为、被动预览、generation卸载撤销及旧endpoint失败；不启动服务器、不访问真实profile。

安装与发布使用官方 `plugin_manager.install_bundle` 指向本包，profile 由安装方按既有流程管理。安装后验收应包含：真实 Host/Client 激活、元数据与图标、三个类型、单/多/混合父子选择、创建后取消、read-only preview 不激活、无会话工作区文件浏览、模型/effort 建议不修改 Session、队列/abort/dispose、FileTree/fallback、窄屏与 light/dark。须在用户正常已认证 GUI 中做视觉验证，不查找 browser token，不以别的新服务或预览页替代现有 GUI。

## Model experience

延迟工具 `resource_picker_read` 提供有界当前会话公开文本读取与 reference 校验；不注入长提示词、不每轮枚举工作区。结果由正常 tool result 记录进入模型历史；纯选择/预览状态不写 Session。命令遵官方 command/run、command/done 生命周期。无隐藏上下文输出、额外 LLM 请求、额外权限或 KV-cache 前缀变化。

## Known limitations

完整 native file chooser 的公开选择接口仍缺，本包只提供 DSH 内部文件浏览器。受限远程 principal 暂不支持本包聚合 RPC；可以由后续正式逐资源鉴权补齐。文件树仅当前层逐级浏览，不实现跨目录搜索；缺少原生 Factory 时的文本 fallback 不是实时流。
