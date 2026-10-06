---
name: frontend-design
description: 当需要生成、重构或评审前端页面（落地页、作品集、产品官网、活动页、应用工作台 / SPA、Dashboard 视觉层）时使用。适用于"做个好看的页面""优化视觉""这个太丑了"等模糊需求。产出自带设计系统、动效、响应式与可访问性的高质量 HTML/CSS/JS。参考 Awwwards / Webby / FWA 获奖品质。
---

# 前端设计 Skill — frontend-design

> 让 Agent 在有限提示词下产出 Awwwards / Webby / FWA 级别的界面。
> 核心主张：**品味 = 约束 + 对比 + 克制 + 一个记忆点。**

---

## 0. 触发条件

**使用本 skill 当：**
- 用户说"做个页面 / 落地页 / 官网"，但没给设计稿
- 用户说"好看点 / 高级点 / 有设计感 / 像 Awwwards 那样"
- 用户给了模糊的参考（"参考 Linear""像 Apple 那样"）
- 需要评审或重构一段"AI 味很重"的前端代码

**不适用：** 需要严格遵守已有 Design System / 品牌规范 / 组件库文档的任务。

---

## 1. 设计哲学（6 条铁律）

1. **内容优先，装饰其次。** 先决定这一屏要说什么，再决定它长什么样。
2. **对比即设计。** 大小对比、明暗对比、疏密对比。缺少对比 = 平庸。
3. **一个记忆点胜过十个亮点。** 每页只允许一个"签名手法"（signature move）。
4. **动效是叙事，不是装饰。** 每个动画都要回答"它在帮用户理解什么"。
5. **留白是主动决策，不是剩余空间。** 该空的地方必须空到"心疼"。
6. **克制。** 能用一种字体就不用两种；能用黑白就不用彩色。

---

## 2. Step 0 — 意图解析（提示词稀缺时的反推协议）

用户只给一句话时，按顺序推断以下 5 项。**不要问用户，直接推断并在代码注释里写明判断。**

| 维度 | 提取方式 | 影响 |
|---|---|---|
| **领域 Domain** | 关键词 → 行业原型 | 决定色板与字体气质 |
| **受众 Audience** | 谁看？开发者 / 投资人 / 消费者 / 招聘方 | 决定信息密度与调性 |
| **情绪 Tone** | 冷静 / 温暖 / 锋利 / 诗意 / 技术感 | 决定动效速度与曲线 |
| **密度 Density** | 内容多少？ | 决定留白比例 |
| **记忆点 Hook** | 全文最关键的一个词/数字/图像 | 决定视觉锚点放哪 |

**推断规则：**
- 提示词 < 10 字 → 走"极简编辑风"（Editorial Minimal），信息少、留白多、字号巨大。
- 提示词含具体数字/数据 → 用大字号数字做视觉锚点。
- 提示词含产品名 → 把产品名做成 hero 级排版主体。

---

### 2.1 页面模式：先分清落地页与应用

- **落地页模式：** 品牌、营销与内容叙事页面，使用下文的纵向章节节奏。
- **应用 / SPA 模式：** 工作台、管理工具或多主题操作界面。默认用顶栏 tabs 切换欢迎页与各工作主题，同一应用壳内只显示当前视图，不把全部主题堆成需要整页长滚动的落地页。保留跨 tab 的共享选择与操作状态。
- **应用壳：** 占满可用视口（`100dvh`），顶栏保持可见；主体尽量不滚动，把列表、日志、详情等长内容放在有边界的内部滚动区。为嵌套 grid / flex 项设置 `min-height: 0`、`min-width: 0`，避免内容撑开外壳。窄屏或高缩放时可由当前视图内部滚动，不能裁掉操作或制造页面横向溢出。
- **欢迎视图仍有设计力度：** 保留 hero / 插画 / 展示级数字与唯一签名手法，作为独立 tab 的完整构图；用非对称分栏、主动留白与字号对比建立张力，不因改成 SPA 而删掉 hero、缩成普通标题或改成均匀卡片网格。工作视图保留相同字体、色彩、圆角与细节语言。
- **已有认可的设计：** 用户只要求局部调整时，冻结其余视觉与功能选择。只改变被点名的部分及其必要适配；不要重新挑选原型、换配色家族、增加装饰或削弱排版层级。

应用模式优先于下文仅适合落地页的纵向章节、区块大间距和第二 hero 页脚规则；其余设计原则仍全部适用。

## 3. Step 1 — 选定设计原型（Archetype）

从下表中**只选一个**，不要混合。混合 = 平庸。

### A. Editorial（编辑风）
- **气质：** 杂志、衬线、克制、大留白
- **字体：** `Instrument Serif` / `Fraunces` / `Bodoni Moda` + `Inter` / `Geist`
- **色板：** 米白 `#F5F2EC` + 墨黑 `#111110` + 一点朱红 `#E2452B`
- **动效：** 缓慢淡入、逐行上浮（800ms+）
- **适合：** 品牌、作品集、文化、奢侈品、餐饮

### B. Technical（技术锋利）
- **气质：** 精密、等宽、锋利、网格感；技术感不依赖暗色底
- **字体：** `Geist` / `Space Grotesk` / `Inter Tight` + `JetBrains Mono`
- **色板：** 默认浅底 `#F5F7F7` + 深墨 `#0A0B0D` + 薄荷 / 青绿或冷紫强调；`#5EEAD4` 可作小面积填充配深色字，浅底上的强调文字与焦点使用较深青绿（如 `#087F73`）；冷紫 `#A78BFA` 同样按用途调整为对比度合格的明度。仅在明确要求暗色时用深底 `#0A0B0D` + 浅字 `#E8EDF2`。
- **动效：** 快（200–400ms）、精准、微交互丰富
- **适合：** SaaS、开发者工具、AI 产品、金融科技

### C. Brutalist（粗野主义）
- **气质：** 高对比、暴露结构、原始、故意"不精致"
- **字体：** `Anton` / `Archivo Black` / `Syne` + 系统等宽
- **色板：** 纯黑 `#000` + 纯白 `#FFF` + 一个刺眼的荧光色
- **动效：** 硬切、无缓动或极短缓动、hover 直接反色
- **适合：** 创意工作室、独立开发者、潮流品牌

### D. Soft / Organic（柔和有机）
- **气质：** 温暖、圆润、呼吸感、光影柔和
- **字体：** `Fraunces` / `DM Serif` + `Manrope` / `Satoshi`
- **色板：** 陶土 `#C4654A` + 奶油 `#FBF7F2` + 苔绿 `#7C8B6F`
- **动效：** 弹性缓动 `cubic-bezier(.34,1.56,.64,1)`、元素轻微漂浮
- **适合：** 健康、生活方式、教育、消费品牌

### E. Kinetic（动态排版驱动）
- **气质：** 巨大的字、滚动驱动、页面即海报
- **字体：** 单一 variable font，用到极致（不同 weight / width / optical size）
- **色板：** 极端——默认全白；明确要求暗色时可全黑，强调色只出现一次
- **动效：** 滚动联动、marquee、文字逐字揭示
- **适合：** 活动页、音乐、展览、个人宣言

---

## 4. Step 2 — Token 系统（必须显式定义）

在 CSS 顶部写完整的 `:root`，**禁止在组件里硬编码颜色和间距**。

### 4.1 字体比例（Type Scale）

```css
:root {
  /* 展示级：用 clamp 保证移动端不爆 */
  --fs-display: clamp(3rem, 11vw, 11rem);
  --fs-h1:      clamp(2.25rem, 6vw, 4.5rem);
  --fs-h2:      clamp(1.75rem, 3.5vw, 3rem);
  --fs-h3:      clamp(1.25rem, 2vw, 1.75rem);
  --fs-body:    clamp(1rem, 1.05vw, 1.125rem);
  --fs-small:   0.875rem;
  --fs-label:   0.75rem;

  /* 行高：标题越紧，正文越松 */
  --lh-display: 0.9;
  --lh-heading: 1.1;
  --lh-body:    1.65;

  /* 字距：大字号必须负字距，标签必须正字距 */
  --ls-display: -0.045em;
  --ls-heading: -0.02em;
  --ls-body:    0;
  --ls-label:   0.12em;
}
```

### 4.2 间距系统（非线性）

```css
:root {
  --sp-1: 0.25rem;  --sp-2: 0.5rem;   --sp-3: 0.75rem;
  --sp-4: 1rem;     --sp-6: 1.5rem;   --sp-8: 2rem;
  --sp-12: 3rem;    --sp-16: 4rem;    --sp-24: 6rem;
  --sp-32: 8rem;    --sp-48: 12rem;   --sp-64: 16rem;

  /* 页面左右外层内边距：默认应用 / WebUI；落地页按第 5 节覆写 */
  --page-gutter: clamp(0.75rem, 1.5vw, 1.5rem);

  /* 区块垂直节奏：移动端收紧，桌面端放大 */
  --section-y: clamp(4rem, 12vw, 12rem);
}
```

> **关键：** 不要所有间距都用同一个值。相邻元素用小间距（8–16px），落地页区块之间用大间距（96–192px）。应用模式把疏密对比放在当前视图内部，按可用高度安排 hero 留白与工作区密度，不机械叠加 96px 区块间距。**疏密对比 = 高级感。**

### 4.3 色板结构（角色化命名，不要叫 primary/secondary）

```css
:root {
  /* 以 Editorial 为例 */
  --c-canvas:   #F5F2EC;   /* 底 */
  --c-ink:      #111110;   /* 主文字 */
  --c-muted:    #6B6862;   /* 次要文字 */
  --c-line:     #DAD5CB;   /* 分割线 */
  --c-accent:   #E2452B;   /* 强调色 —— 全页占比 ≤ 5% */
  --c-surface:  #FFFFFF;   /* 卡片面 */

  /* 语义别名 */
  --bg: var(--c-canvas);
  --fg: var(--c-ink);
}
```

**默认浅色模式，所有原型一致。** 不因系统偏好或 Technical 原型自动切到深色。只有用户明确要求时才支持暗色或跟随系统，并覆写同名变量，不复制整套样式。转换已有暗色设计时保留原强调色家族与层级，只调整底、文字、边框、状态色的明度以满足对比度；正文 ≥ 4.5:1，必要控件边界与焦点 ≥ 3:1。

### 4.4 圆角 / 阴影 / 边框

```css
:root {
  --r-sm: 4px; --r-md: 10px; --r-lg: 20px; --r-full: 999px;

  /* 阴影：克制。一个页面最多两级 */
  --sh-1: 0 1px 2px rgb(0 0 0 / .04), 0 4px 12px rgb(0 0 0 / .04);
  --sh-2: 0 12px 40px -12px rgb(0 0 0 / .18);

  --border: 1px solid var(--c-line);
}
```

### 4.5 动效曲线（唯一真相源）

```css
:root {
  --ease-out:   cubic-bezier(0.16, 1, 0.30, 1);     /* 主曲线：进入 */
  --ease-inout: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring:cubic-bezier(0.34, 1.56, 0.64, 1);  /* 弹性：仅用于小元素 */

  --dur-fast:   180ms;
  --dur-base:   320ms;
  --dur-slow:   700ms;
  --dur-reveal: 900ms;
}
```

---

## 5. Step 3 — 版面结构（打破网格的方法）

**基础网格：** 12 列，内容区 `max-width: 1440px`，`gap: 24px`。内容宽度上限与居中产生的自动外边距不等于 padding，不通过叠加 padding 实现居中。

- **应用 / SPA / WebUI：** 应用壳本身占满视口；左右外层内边距使用 `padding-inline: var(--page-gutter)`，默认 `clamp(0.75rem, 1.5vw, 1.5rem)`（通常窄屏约 12–16px、桌面约 16–24px，按默认 16px 根字号计）。同一横向内容路径只由一层容器承担外层内边距，不在应用壳、主容器与 tab 面板上重复叠加；控件与卡片自身的内部 padding 仍按需保留。欢迎视图通过内部非对称构图、主动留白与字号对比保持张力，不靠加宽全局侧边留白。
- **落地页：** 将 `--page-gutter` 覆写为 `clamp(1.25rem, 5vw, 5rem)`，保留原有宽松左右留白与纵向章节节奏；不把这一外层内边距默认套用于工作台。

**但要打破它。** 至少用以下手法之一：

| 手法 | 做法 |
|---|---|
| **非对称分栏** | Hero 用 7/5 或 8/4，不要 6/6 |
| **越界元素** | 图片 `margin-left: calc(-1 * var(--sp-16))`，让它出血 |
| **超大字号溢出** | 标题 `font-size: 13vw`，允许横向溢出 + `overflow-x: clip` |
| **错位基线** | 相邻两栏顶部不对齐，故意差 40–80px |
| **全宽 vs 容器宽混用** | 图片全宽，文字容器宽，制造呼吸节奏 |
| **粘性侧栏** | `position: sticky; top: 6rem` 让左栏停住，右栏滚动 |

**落地页模式的结构节奏（应用模式使用 2.1 的顶栏 tabs，不强制附加以下章节）：**

```
Hero（1 个视觉锚点 + 1 句主张 + 1 个 CTA）
  ↓ 大留白
Proof / 数据 / 客户（用大数字或 logo 墙）
  ↓
Core Value（2–3 个，不要 3 个一模一样的卡片！用 2 栏交错或列表式）
  ↓
深度内容（图文混排 / 粘性滚动）
  ↓
收尾 CTA（要克制，一个按钮）
  ↓
Footer（可以很有设计感——大字排版、超大 logo）
```

> **禁止：** "三张一模一样的圆角卡片 + 图标 + 标题 + 两行描述" —— 这是 AI 味的头号来源。改成：交替左右图文、编号列表、手风琴、横向滚动。

---

## 6. Step 4 — 动效与交互

### 6.1 入场揭示（落地页必备，应用中仅用于欢迎视图或关键视图切换）

```html
<h1 data-reveal>...</h1>
<p data-reveal data-delay="1">...</p>
```

```css
[data-reveal] {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity var(--dur-reveal) var(--ease-out),
    transform var(--dur-reveal) var(--ease-out);
  transition-delay: calc(var(--d, 0) * 80ms);
}
[data-reveal].is-in { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
}
```

```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('is-in');
    io.unobserve(e.target);
  }
}, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

document.querySelectorAll('[data-reveal]').forEach((el) => {
  if (el.dataset.delay) el.style.setProperty('--d', el.dataset.delay);
  io.observe(el);
});
```

应用内部滚动时，将 observer 的 `root` 指向实际滚动容器，或直接在视图激活时揭示。不要让隐藏 tab 的内容停留在不可见状态；切换 tab 不应重播所有元素的长入场动画。

### 6.2 磁性按钮（签名手法候选）

```js
document.querySelectorAll('[data-magnetic]').forEach((el) => {
  const strength = Number(el.dataset.magnetic) || 0.25;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  });
  el.addEventListener('pointerleave', () => {
    el.style.transform = '';
  });
});
```

```css
[data-magnetic] {
  transition: transform 400ms var(--ease-out);
  will-change: transform;
}
```

### 6.3 滚动进度 + 视差（可选）

```js
// 用 rAF 节流，不要直接在 scroll 里改样式
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty(
      '--scroll-y', `${window.scrollY}px`
    );
    ticking = false;
  });
}, { passive: true });
```

```css
.parallax-slow { transform: translate3d(0, calc(var(--scroll-y) * -0.08), 0); }
```

### 6.4 动效规则

- **时长：** 微交互 180–320ms；元素揭示 700–900ms；页面转场 400–600ms。超过 1s 会显得迟钝。
- **只动 `transform` 和 `opacity`。** 不要动 `width` / `top` / `margin`。
- **缓动方向：** 进入用 ease-out（快起慢停），离开用 ease-in。
- **尊重 `prefers-reduced-motion`。** 这是硬性要求。
- **不要给所有东西加动效。** 每屏 1–2 个动效足够。

---

## 7. Step 5 — 质感与细节（拉开差距的地方）

### 7.1 颗粒噪点（几乎万能）

```css
.grain::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.035;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

### 7.2 焦点态（不要用浏览器默认）

```css
:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 3px;
  border-radius: var(--r-sm);
}
```

### 7.3 链接下划线（有质感的）

```css
.link {
  background-image: linear-gradient(currentColor, currentColor);
  background-size: 0% 1px;
  background-position: 0 100%;
  background-repeat: no-repeat;
  transition: background-size var(--dur-base) var(--ease-out);
}
.link:hover { background-size: 100% 1px; }
```

### 7.4 排版微调（必须做）

```css
h1, h2, h3 {
  text-wrap: balance;          /* 标题断行更均匀 */
  letter-spacing: var(--ls-heading);
  line-height: var(--lh-heading);
}
p { text-wrap: pretty; }
.display { font-size: var(--fs-display); line-height: var(--lh-display); letter-spacing: var(--ls-display); }
.label {
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--c-muted);
}
```

### 7.5 图片与媒体

```css
img, video { display: block; max-width: 100%; height: auto; }
.media { aspect-ratio: 4 / 5; object-fit: cover; }
.media-hover { overflow: hidden; }
.media-hover img {
  transition: transform 800ms var(--ease-out);
}
.media-hover:hover img { transform: scale(1.04); }
```

> **不要用 `border-radius: 12px` 给所有东西。** 要么统一用一种圆角，要么就全是直角。混用会显得廉价。

---

## 8. Step 6 — 自检清单（交付前逐条核对）

**排版**
- [ ] 全页字体家族 ≤ 2 个
- [ ] 存在至少一个 `clamp()` 定义的展示级字号
- [ ] 大标题有负字距，小标签有大写字距
- [ ] 标题行高 ≤ 1.15，正文行高 ≥ 1.6

**色彩**
- [ ] 强调色占页面面积 ≤ 5%
- [ ] 没有紫蓝渐变（除非品牌明确要求）
- [ ] 正文对比度 ≥ 4.5:1
- [ ] 首次打开为浅色；只有明确要求才启用暗色 / 跟随系统，且文字、状态与焦点对比度合格

**版面**
- [ ] 至少打破网格一次（出血 / 非对称 / 越界）
- [ ] 落地页区块间距 ≥ 96px（桌面）；应用视图内有主动留白与疏密对比，没有为满足区块间距而制造整页滚动
- [ ] 应用外层左右内边距使用较小的 `--page-gutter`，同一内容路径没有重复叠加；欢迎视图的内部留白与排版层级仍保留
- [ ] 没有"三张一样的卡片"
- [ ] Hero 区 3 秒内能看懂在说什么；应用欢迎 tab 保留完整 hero / 视觉锚点
- [ ] 应用模式：顶栏 tabs 真实切换视图、状态同步；桌面应用壳不随长列表 / 日志增高，内部滚动与窄屏访问均可用

**动效**
- [ ] 所有动画只用 transform / opacity
- [ ] 有 `prefers-reduced-motion` 降级
- [ ] 没有超过 1s 的交互反馈
- [ ] 滚动监听用了 `passive: true` + rAF

**工程**
- [ ] 语义化标签（`header` / `main` / `section`，有页脚内容时用 `footer`）；tabs 有正确的选中态、关联面板和键盘操作
- [ ] 所有图片有 `alt`，装饰图 `alt=""`
- [ ] 移动端 375px 不横向滚动
- [ ] 所有按钮/链接有 `:focus-visible`
- [ ] 没有 `!important`（除非覆盖第三方）

**品味**
- [ ] 页面有且仅有 1 个"签名手法"
- [ ] 删掉了至少 3 个"感觉可以加"的元素
- [ ] 如果截图发到 Awwwards，你不会尴尬

---

## 9. 反模式黑名单（见到即删）

| ❌ 反模式 | ✅ 替代 |
|---|---|
| 紫色→蓝色渐变 + 白色圆角卡片 | 单色 + 一个强调色 |
| Emoji 当图标用 | SVG 图标或纯排版 |
| "Welcome to our website!" | 具体的、有信息量的主张 |
| 三张相同卡片配图标 | 交错图文 / 编号列表 / 横向滚动 |
| 所有元素 `border-radius: 12px` | 统一圆角语言，或全直角 |
| Inter 16px + 均匀间距 | 建立字号与间距的层级 |
| 满屏阴影 + 玻璃拟态 | 一个阴影层级 + 细边框 |
| 每个元素都 fade-in | 只有关键元素揭示，其余静态 |
| 居中一切 | 非对称、左对齐、出血 |
| 落地页页脚只有版权 | 落地页页脚当第二 Hero 做；应用不强制营销页脚 |
| `transition: all .3s` | 明确指定属性 |
| 自动播放的背景视频配大字 | 除非内容需要，否则不要 |

---

## 10. 输出规范

生成代码时：

1. **单文件优先**（`index.html` + 内联 `<style>` + `<script>`），除非用户要求分文件。
2. **CSS 顶部必须先写完整 `:root` token 块**，含注释标注设计原型。
3. **代码注释中标明推断结果**：
   ```css
   /* Archetype: Editorial — 推断依据：提示词含"手冲咖啡"，受众为品质消费者 */
   ```
4. **交互用事件委托；滚动揭示用 `IntersectionObserver`**，应用视图切换可直接控制关键入场状态。不引入外部库（除非用户指定）。
5. **响应式断点：** `640px` / `1024px`。移动端优先，但桌面端体验是重点。
6. **交付时附 3 行说明：** 设计原型 / 签名手法 / 可替换的 token 位置。

---

## 11. 快速参考卡

```
字号   display: clamp(3rem, 11vw, 11rem)  lh .9   ls -.045em
       h1:      clamp(2.25rem, 6vw, 4.5rem)
       body:    16–18px  lh 1.65
间距   落地页区块 96–192px｜元素 8–24px｜疏密比 ≥ 4:1，应用在视图内实现
色彩   默认浅色｜1 底 + 1 墨 + 1 灰 + 1 强调（≤5%）
动效   ease-out cubic-bezier(.16,1,.3,1)｜180/320/700/900ms
       只动 transform + opacity
圆角   选一种，用到底
签名   每页 1 个，不多不少
底线   reduced-motion / focus-visible / 对比度 4.5:1
```

---

**最后一句：** 如果生成的页面删掉一半元素后变得更好看，那说明第一版做得还不够狠。**克制是最贵的设计。**