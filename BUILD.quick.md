# DSH Desktop 快速构建指南（Win / Mac 日常版）

> 适用: `deepseek-harness-desktop` 仓库（Yarn 4 monorepo）
> 简化自 [BUILD.md](BUILD.md)——只保留日常构建/打包，签名公证、打包细节见原文档。

---

## 0. 命令速查

| 想做什么 | Mac | Win |
|---|---|---|
| 装依赖（首次） | `corepack yarn install` | 同左 |
| 编译源码（lib/） | `corepack yarn workspace dsh-plugin-desktop build` | 同左 |
| 快速预览 UI | `... package:dir` + `open "dist/mac-arm64/DSH Desktop.app"` | `... package:dir` + 打开 `dist/win-unpacked/` 下的 exe |
| 出无签名安装包 | `corepack yarn workspace dsh-plugin-desktop dist:mac-smoke` | `corepack yarn workspace dsh-plugin-desktop dist:win` |
| 正式发布（需签名） | `... dist:mac`（要 Apple 凭证） | Win 签名是独立步骤，脚本不签 |
| 只编译单个插件产物 | `cd dsh-plugin-desktop && corepack yarn tsdown`（快速，只出 lib/*.js） | 同左 |

> 所有命令都在 **仓库根目录** 执行（`cd deepseek-harness-desktop`），用 `corepack yarn`（不要裸 `yarn`）。

---

## 1. 前置条件

| 项 | 要求 |
|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0`，**必须带 bundled Corepack**（脚本硬校验版本） |
| 构建主机 | **Mac 产物必须在 Mac 构建，Win 产物必须在 Win 构建**（不能交叉打包） |
| 网络 | 可访问 npm registry（首次要下载 electron、native 依赖，较慢） |
| 磁盘 | 建议 ≥ 10GB 空闲 |

---

## 2. 首次初始化（只需一次）

```bash
cd deepseek-harness-desktop
git submodule update --init        # 官方子模块，layout 校验需要
corepack yarn install               # 装依赖（首次较慢）
```

> 注意：`deepseek-harness/` 子模块**不参与构建**，产物用的是 npm 上的 `@deepseek-ai/*` 包，改了子模块代码不会进产物。

---

## 3. 日常流程

### 3.1 改完代码 → 编译源码（最快，通常几十秒）

```bash
cd deepseek-harness-desktop
corepack yarn workspace dsh-plugin-desktop build
# 产出: dsh-plugin-desktop/lib/*.js + 类型声明
```

只想快速出某个插件的 JS（不跑完整 build，更快）：

```bash
cd dsh-plugin-desktop && corepack yarn tsdown    # 只重建 lib/
```

### 3.2 快速预览 UI（推荐日常用，几分钟看到界面）

```bash
cd deepseek-harness-desktop
corepack yarn workspace dsh-plugin-desktop build         # 1. 先构建最新代码
corepack yarn workspace dsh-plugin-desktop package:dir   # 2. 生成未打包应用
```

- **Mac**: `open "dsh-plugin-desktop/dist/mac-arm64/DSH Desktop.app"`（双击也行）
- **Win**: 打开 `dsh-plugin-desktop/dist/win-unpacked/DSH Desktop.exe`
- 未签名首次打开若提示"无法验证开发者"，系统设置 → 隐私与安全性 → 仍要打开

### 3.3 出安装包（分发/测试用）

```bash
# Mac: 无签名 universal DMG（无需任何 Apple 凭证）
corepack yarn workspace dsh-plugin-desktop dist:mac-smoke

# Win: 无签名 NSIS 安装器
corepack yarn workspace dsh-plugin-desktop dist:win
# 产物: dist/DSH-Desktop-*-Setup.exe
```

> 日常本地验证用 **package:dir** 最快；**dist:mac / 正式签名发布** 需要凭证，见 BUILD.md §5.4。

---

## 4. 质量校验（可选）

```bash
cd deepseek-harness-desktop
corepack yarn workspace dsh-plugin-desktop typecheck   # 类型检查（4 个 tsconfig）
corepack yarn workspace dsh-plugin-desktop test        # vitest 单测
# 或根目录 yarn check 全量（build + typecheck + test + verify 系列，较慢）
```

不启动 GUI 验证插件装配是否正常：

```bash
corepack yarn workspace dsh-plugin-desktop verify:profile
```

---

## 5. 常见问题

**Q: `yarn check` 报 layout 校验失败？**
→ `git submodule update --init` 初始化子模块。

**Q: 报 Node 版本错误？**
→ 需要 `^22.19.0` 或 `>=24.0.0` 且带 bundled Corepack。用 nvm 的话确认当前 shell 切到了正确版本。

**Q: 能在 Mac 上打 Windows 包吗？**
→ 不能。脚本强制平台一致：Win 包必须 Windows 主机，Mac 包必须 Mac 主机。

**Q: 本地没有 Apple 开发者账号，怎么出 Mac 包？**
→ 用 `dist:mac-smoke`，无签名 DMG，不需要任何凭证。

**Q: 改了 `deepseek-harness/` 子模块代码，产物会变吗？**
→ 不会。产物只依赖 npm 上的 `@deepseek-ai/*` 包，子模块不参与构建。

---

> 完整细节（electron-builder 配置、签名/公证凭证清单、质量门禁、打包流程）见 [BUILD.md](BUILD.md)。
