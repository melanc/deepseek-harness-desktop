# DSH Desktop 构建与打包指南

> 适用范围: `deepseek-harness-desktop` 仓库（v2.0.1，Yarn 4 monorepo）
> 更新日期: 2026-08-20
> 关联: [架构说明](docs/architecture.md)、[`dsh-plugin-desktop/README.md`](dsh-plugin-desktop/README.md)

---

## 1. 构建总览

DSH Desktop 的构建链路分两级：

```
源码 (TypeScript)
  → tsdown 打包 + tsc 类型声明        (dsh-plugin-desktop 的 build)
  → electron-builder 26 生成安装包    (dist:mac / dist:win / package:dir)
```

关键事实：

- **只有 `dsh-plugin-desktop` 是真正构建的 workspace**；`dsh-community-fabric` 与 `dsh-community-market` 目前是纯文档脚手架。
- **`deepseek-harness/` 官方子模块不被编译**。运行时使用的是 npm 上的 `@deepseek-ai/*` 包；子模块仅被根目录 `yarn check` 的 layout 校验读取（验证 `package.json` 的 packageManager 等），不参与产物生成。
- 桌面运行时要求 **Node 22.19+ 或 24.x 且带 bundled Corepack**——所有打包脚本都会硬校验，不满足直接抛错。
- macOS 产物为 **universal（arm64 + x86_64 双架构）**；Windows 产物为 **x64 NSIS 安装器**。
- **平台绑定**：mac 包必须在原生 macOS 主机构建，win 包必须在原生 Windows 主机构建（脚本强制检查 `process.platform`）。

---

## 2. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0` | 必须带 bundled Corepack；脚本会校验主/次版本号 |
| Yarn | 4.18.0 | 根 `package.json` 的 `packageManager` 字段指定，`corepack yarn` 即可 |
| Git 子模块 | `deepseek-harness/` 已 checkout | 缺失时 `yarn check` 的 layout 校验失败（仅校验需要） |
| 构建主机 | macOS（x64/arm64）或 Windows（x64） | 平台与目标产物必须一致，不能交叉构建 |
| 网络 | 可访问 npm registry | 需下载 electron 43、全部 `@deepseek-ai/*` 包及 native 依赖 |
| 磁盘 | 建议 ≥ 10GB 空闲 | node_modules + electron 缓存 + dist 产物 |

**初始化子模块**（当前仓库尚未 checkout）：

```bash
git submodule update --init
```

---

## 3. 标准构建步骤（以 macOS 为例）

```bash
# 1. 初始化官方子模块（layout 校验需要）
git submodule update --init

# 2. 安装依赖（仓库根目录）
corepack yarn install

# 3. 完整验证（可选但推荐）
yarn check
#    等价于: yarn check:layout
#            + yarn workspace dsh-community-fabric check
#            + yarn workspace dsh-community-market check
#            + yarn workspace dsh-plugin-desktop check
```

> `yarn install` 与完整构建耗时较长（下载 electron、sharp/koffi/node-pty 等 native 依赖），首次执行请预留时间。

---

## 4. 产物与命令速查

| 命令 | 产物 | 是否需要签名凭证 | 用途 |
|---|---|---|---|
| `yarn dev` | —（先 build 再启动） | 否 | 开发调试 |
| `yarn build` | `dsh-plugin-desktop/lib/`（JS + d.ts） | 否 | 仅编译源码 |
| `yarn package:dir` | `dsh-plugin-desktop/dist/` 未打包 `.app`/目录 | 否 | 跨平台快速验证产物结构 |
| `yarn dist:mac-smoke` | **无签名** universal DMG（`dsh-plugin-desktop/dist/mac-smoke/`） | **否** | CI 回归、本地验证 mac 打包 |
| `yarn dist:mac` | **签名 + 公证** universal DMG（`dist/mac-release/`） | **是** | 正式发布 macOS |
| `yarn dist:win` | 无签名 NSIS 安装器 `DSH-Desktop-*-Setup.exe` | 否（签名是独立步骤） | Windows 打包验证/发布 |

---

## 5. 各命令详解

### 5.1 `yarn build` — 编译源码

`dsh-plugin-desktop` 的 build 脚本：

```bash
node scripts/generate-mac-app-icon.mjs && \
node scripts/generate-tray-icons.mjs && \
node scripts/clean.mjs && \
tsdown && \
tsc -p tsconfig.json --emitDeclarationOnly && \
tsc -p tsconfig.client.json --emitDeclarationOnly
```

产出：`lib/*.js`（tsdown 打包）+ `lib/types/**/*.d.ts`（类型声明）。

### 5.2 `yarn package:dir` — 未打包应用

`scripts/package-dir.mjs`：

```bash
electron-builder --dir
```

- 使用 `CSC_IDENTITY_AUTO_DISCOVERY: false` 禁用签名自动发现；
- 产出未打包的应用目录（macOS 为 `.app`），用于结构验证，不生成安装器。

### 5.3 `yarn dist:mac-smoke` — 无签名 DMG（CI/本地验证）

入口 `dsh-plugin-desktop/scripts/package-mac.ts`，流程：

1. **校验环境**：平台必须是 `darwin`；架构必须是 `x64` 或 `arm64`；Node 必须是 22.19+ 或 24.x。
2. **剥离签名凭证**：清空所有 `CSC_*` / `APPLE_*` 等签名环境变量，确保无签名构建不受本机凭证干扰。
3. **跑 `check:mac-package`**：`build` + `typecheck` + 打包相关 vitest 单测（`mac-universal.spec.ts`、`package*.spec.ts`、`release-*.spec.ts` 等）+ `verify:closure` 运行时闭包校验。
4. **准备 universal runtime**（`mac-universal.ts` 的 `prepareInstalledMacUniversalRuntime`）：确保 `node_modules` 中同时存在 arm64 与 x86_64 两套 native 依赖：
   - `@img/sharp-darwin-{arm64,x64}`（sharp + libvips）
   - `@koromix/koffi-darwin-{arm64,x64}`
   - `@vscode/ripgrep-darwin-{arm64,x64}`
   - `node-addon-require-builtin-darwin-{arm64,x64}`
   - `node-pty/prebuilds/darwin-{arm64,x64}`（pty.node + spawn-helper）
5. **执行 electron-builder**：

   ```bash
   electron-builder --mac dmg --universal --publish never \
     --config.mac.notarize=false \
     --config.npmRebuild=false \
     --config.directories.output=dist/mac-smoke
   ```

   同时设 `CSC_IDENTITY_AUTO_DISCOVERY: false`。
6. **验证产物**：`verify-mac-smoke.ts` 校验 DMG 结构。

### 5.4 `yarn dist:mac` — 签名 + 公证 DMG（正式发布）

入口 `dsh-plugin-desktop/scripts/release-mac.ts`，流程：

1. 仓库根跑 `yarn check`（全量验证）。
2. **凭证预检**（`release-preflight.ts`）：
   - 校验签名身份（Developer ID）与公证凭证；
   - 校验 `MAC_CERT_P12_BASE64`（Base64 编码的 PKCS#12 文件，必须含合法的 DER 头）；
   - 校验 `MACOS_SIGN_IDENTITY`。
3. 适配环境变量到 electron-builder 的 `CSC_*` 约定。
4. 同 smoke：准备 universal runtime → `electron-builder --mac dmg --universal`（此时 `notarize: true`，来自 package.json 的 `build.mac.notarize`）→ `verify-mac-release.ts` 校验。

**签名/公证凭证来源**（三选一或组合）：

| 用途 | 环境变量 |
|---|---|
| 签名（keychain 身份） | `CSC_NAME` / `MACOS_SIGN_IDENTITY` / `CSC_IDENTITY_AUTO_DISCOVERY` |
| 签名（P12 证书） | `MAC_CERT_P12_BASE64`（或 `CSC_LINK` + `CSC_KEY_PASSWORD`） |
| 公证（API Key） | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` |
| 公证（Apple ID） | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` |
| 公证（keychain profile） | `APPLE_KEYCHAIN_PROFILE` / `APPLE_KEYCHAIN` |
| 团队/其他 | `APPLE_TEAM_ID`、`CSC_INSTALLER_LINK`、`CSC_INSTALLER_KEY_PASSWORD` |

完整清单见 `release-preflight.ts` 的 `RELEASE_VARIABLES`。

### 5.5 `yarn dist:win` — Windows NSIS 安装器

入口 `dsh-plugin-desktop/scripts/package-win.ts`，流程：

1. 校验平台为 `win32`、架构为 `x64`、Node 版本合规。
2. 剥离 Windows 签名凭证（`CSC_*` / `WIN_CSC_*`）。
3. 通过 `cmd.exe /d /s /c` 跑 `check:win-package`（build + typecheck + Windows 相关单测 + closure）。
4. 执行 electron-builder：

   ```bash
   electron-builder --win nsis --x64
   ```

5. `verify-win-installer.ts` 验证安装器。

产物名：`DSH-Desktop-${version}-${arch}-Setup.exe`。Authenticode 代码签名是独立的发布步骤，不在该脚本内。

---

## 6. electron-builder 打包配置要点

配置位于 `dsh-plugin-desktop/package.json` 的 `build` 字段：

| 项 | 值 | 说明 |
|---|---|---|
| `appId` | `ai.deepseek.dsh.desktop` | 应用标识 |
| `productName` | `DSH Desktop` | 显示名 |
| `asar` | `true` | 启用 ASAR |
| `asarUnpack` | `package.json`、`cordis.patch.yml`、`build/**`、`lib/**`、`node_modules/**` | **近乎全量 unpack**——Cordis 运行时需要物理文件路径（`app.asar.unpacked`） |
| `afterPack` | `scripts/verify-packaged-runtime.ts` | 打包后校验运行时闭包 |
| `electronFuses.runAsNode` | `true` | 允许 Node 模式（桌面内置 pnpm 需要） |
| `directories.output` | `dist` | 产物目录 |
| `mac.target` | `dir`（release 脚本改为 `dmg`） | — |
| `mac.hardenedRuntime` | `true` | 硬化运行时 |
| `mac.notarize` | `true` | 公证（smoke 用 `--config.mac.notarize=false` 关闭） |
| `mac.mergeASARs` | `false` | 不合并 ASAR |
| `mac.x64ArchFiles` | 见前文 native 清单 | 指定 x64 原生文件的 glob |
| `win.target` | `nsis` + `x64` | NSIS 安装器 |
| `nsis.oneClick` | `false` | 向导式安装 |
| `nsis.artifactName` | `DSH-Desktop-${version}-${arch}-Setup.${ext}` | 安装器命名 |
| `nsis.perMachine` | `false` | 每用户安装 |
| `linux.target` | `dir` | Linux 仅目录产物（兼容模式） |

相关：`.yarnrc.yml` 配置了 `supportedArchitectures` 同时包含 `x64` 与 `arm64`——mac universal 打包的前提。

---

## 7. 质量门禁（check 系列）

`yarn check`（根）依次执行：

1. **`check:layout`**（`scripts/verify-layout.mjs`）：验证仓库拓扑——三个 workspace 的归属、`deepseek-harness` 必须是 Git submodule 且 URL 与 `upstream.json` 一致、子模块保留 pnpm packageManager、禁用遗留文件。
2. **`dsh-community-fabric check`** / **`dsh-community-market check`**：文档脚手架自身的校验。
3. **`dsh-plugin-desktop check`**：`build` → `typecheck`（4 个 tsconfig）→ `test`（vitest）→ 一系列 verify：
   - `verify:closure`：生产依赖图必须包含所有必需的第一方 peer（运行时闭包完整）；
   - `verify:cli`：CLI 运行时可用；
   - `verify:loader`：headless Loader 启动冒烟；
   - `verify:profile`：profile 启动冒烟；
   - `verify:licenses`：许可证合规。

平台专属门禁：`check:mac-package` / `check:win-package`（见 5.3/5.5）。

---

## 8. 常见问题

**Q1: `yarn check` 报 layout 校验失败？**
子模块未初始化。执行 `git submodule update --init`。

**Q2: 打包脚本报 Node 版本错误？**
需要 `^22.19.0` 或 `>=24.0.0`。检查 `node --version`；若用 nvm，确保当前 shell 使用了正确版本，且该版本带 bundled Corepack。

**Q3: 在 macOS 上能构建 Windows 安装包吗？**
不能。`package-win.ts` 强制 `platform === 'win32'`。Windows 产物必须在 Windows 主机（或 Windows CI runner）构建。mac 亦然。

**Q4: 本地没有 Apple 开发者账号，怎么出 mac 包？**
用 `yarn dist:mac-smoke`——产出无签名 universal DMG，`notarize=false`，无需任何 Apple 凭证。适合本地验证与 CI。

**Q5: `dist:mac` 报签名/公证失败？**
凭证预检失败。确认 `MAC_CERT_P12_BASE64`（Base64 PKCS#12，含 DER 头 `0x30`）或 keychain 身份 + Apple API key/Apple ID 已正确配置。smoke 构建不检查这些。

**Q6: 改了 `deepseek-harness/` 子模块里的代码，产物会变吗？**
不会。产物依赖 npm 上的 `@deepseek-ai/*` 发布包，子模块源码不参与构建（AGENTS.md 也禁止从桌面分支修改子模块）。

---
方式一：快速预览（推荐，几分钟内看到 UI）
先重新构建（确保最新代码），再生成未打包的 .app 直接打开：

bash
复制
cd deepseek-harness-desktop

# 1. 构建所有产物（tsdown 打包 Host + Client）
corepack yarn workspace dsh-plugin-desktop build

# 2. 生成未打包的 macOS .app（不需要签名/公证）
corepack yarn workspace dsh-plugin-desktop package:dir
产物在 dsh-plugin-desktop/dist/mac-arm64/DSH Desktop.app（或 dist/mac/），直接双击打开，或：

bash
复制
open "dsh-plugin-desktop/dist/mac-arm64/DSH Desktop.app"
优点：快、无签名要求、立刻看到 UI（侧边栏「主会话」按钮、会话页「任务」tab）。

方式二：完整安装包（DMG，分发用）
bash
复制
cd deepseek-harness-desktop
corepack yarn dist:mac-smoke
产出无签名 universal DMG（dist/mac-smoke/），适合装到其他机器或发测试。这个更慢（要打包双架构 native 依赖），且是完整安装体验。

注意点：

package:dir 最快——它只跑 electron-builder --dir，不生成 DMG 镜像，直接是可运行的 .app。
如果启动后 UI 没变化，先确认 package:dir 里用的 lib/ 是最新构建（上面第 1 步的 build 保证）。
如果只是想看代码层面是否正常（不启动 GUI），也可以跑 corepack yarn workspace dsh-plugin-desktop verify:profile——它验证插件装配，日志里能看到 message-channels 插件激活、主会话创建尝试。
首次打开 .app 若提示"无法验证开发者"（未签名），在系统设置 → 隐私与安全性 → 仍要打开。
