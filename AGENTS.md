# React + TypeScript 代码规范

本项目的前端UI编码规范，Python部分不适用此规范要求。

## 功能导航

- 查找、解释或修改项目功能实现前，使用项目级 [feature-map skill](.agents/skills/feature-map/SKILL.md)，先从 [docs/feature-map.yaml](docs/feature-map.yaml) 匹配功能，按需阅读其指向的 `docs/features/` 专题文档，再核对当前源码。
- 新增、变更、删除功能或重构影响导航映射时，在同一次任务中按该 skill 更新受影响条目；纯只读分析不修改文件。导航尚未完整收录，不为补齐导航扩大当前任务范围。

## 防御式编程

- 优先使用守卫语句处理无效输入、缺失前置条件、加载、错误和空状态，通过提前 `return` / `continue` 让正常路径保持扁平，避免多层 `if`、嵌套三元表达式和难以追踪的 `else` 分支
- 多个互斥状态按业务优先级依次判断，每个分支只负责一种明确结果；重构控制流时必须保持原有状态优先级、错误反馈和用户可观察行为
- 只防御真实存在或契约允许出现的边界；禁止为假想场景堆叠兜底、静默吞掉错误、把非法数据强制转换成合法数据，或用默认值掩盖接口与状态问题
- 外部输入、网络响应和持久化数据在边界处完成校验；边界内优先依赖已确认的类型与不变量，不重复添加无意义检查

```tsx
function Content({ data, error, isPending }: ContentProps) {
  if (isPending) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState />;
  }

  if (!data) {
    return <EmptyState />;
  }

  return <ResultView data={data} />;
}
```

## 组件开发

- 使用函数式组件 + Hooks，禁止使用类组件
- 独立组件使用目录结构：`ComponentName/index.ts` (只导出所有组件，无具体实现), `ComponentName/ComponentName.tsx`, `ComponentName/types.ts`；使用 CSS Modules 的组件增加 `ComponentName/styles.module.css`
- 独立组件在声明时直接导出：`export function ComponentName({ value }: ComponentProps) { ... }`；同文件私有组件仅适用下方“内部组件”规定的例外，保持不导出

## TypeScript 类型

- 组件 Props 和对象定义优先使用 `interface`，简单类型允许使用 `type`
- 类型定义放在单独的 `types.ts` 文件中，与组件同目录；按“内部组件”规则定义的同文件私有组件，其专属 Props 类型允许在实现文件中就近声明

## 样式方案

- 使用 Tailwind 作为统一的设计 Token 与布局语言；颜色、间距、字号、圆角、阴影和断点优先使用语义化主题变量及其 utility，避免散落硬编码值
- `components` 中的通用、可复用组件使用 Tailwind 实现；存在合适基础组件时优先基于 shadcn/ui 组合或封装，并由项目组件对外提供稳定、语义清晰的 Props 和 variants API
- 业务专用、高度定制或包含复杂选择器、动画和第三方样式覆盖的组件使用 CSS Modules，文件名统一为 `styles.module.css`，类名使用 camelCase
- 通用组件默认保留 Tailwind；仅当大量 utility class 已明显掩盖 JSX 结构、状态关系或组件语义时，才将相关样式切换到 CSS Modules
- 同一组件混用 Tailwind 与 CSS Modules 时必须划分清晰职责，禁止对同一样式属性重复声明或依赖加载顺序覆盖
- 优先复用现有 token 和 utility；任意值只用于无法由现有设计语言表达的一次性场景，重复出现时应提升为主题 token
- 不为缩短单个 `className` 提前创建样式抽象，也不使用 `@apply` 复制 utility 组合；优先抽取具有独立语义和稳定 API 的组件

## 命名规范

- 组件文件/目录使用 PascalCase：`UserCard/`、`UserCard.tsx`
- 非组件工具文件使用 camelCase：`useAuth.ts`、`formatDate.ts`
- 常量使用 UPPER_SNAKE_CASE，类型/接口使用 PascalCase

### 请求函数命名

- 根据请求的实际业务语义命名，不按 HTTP method 决定前缀；例如通过 GET 更新智能托管状态仍命名为 `updateAutopilotMode`，通过 POST 查询方案工单仍使用 `getIncidentPlanOrderInfoByEventId`
- 获取详情、状态或其他信息使用 `getXxxInfo`；获取分页列表使用 `getXxxList`，获取全量列表使用 `getAllXxxList`，明确区分单条信息、分页结果与完整列表
- 新增使用 `addXxx`，更新使用 `updateXxx`，删除使用 `deleteXxx`；同类请求不混用 `create`、`alter`、`set`、`remove` 等前缀
- 保留能说明数据形态、范围和查询条件的词，不为缩短名称省略业务语义；例如事件列表快照使用 `getEventListSnapshotInfo`，不能省略 `List`，按条件查询时保留 `ByEventId`、`ByTarget` 等后缀
- 登录、注册、刷新、方案生成与提交、指令发送、连接与断开、导出和查验等明确的业务动作，使用对应动作动词，不强行套用增删改查前缀
- 重命名时同步导出、调用方、相关测试、Storybook 和功能导航；仅调整函数名时，不修改请求 URL、HTTP method、参数、响应处理或业务行为

## 组件编写

- Props 解构在函数参数中：`function UserCard({ name, age }: UserCardProps)`
- 优先使用具名导出（`export function`），避免默认导出
- 事件处理函数以 `handle` 命名（组件内），以 `on` 命名（Props 回调）

### 内部组件

- 仅由某个页面或组件使用、但具有独立职责的一级子组件，放在该页面或组件目录的 `__internal__` 下，并继续遵循 `ComponentName/index.ts`、`ComponentName/ComponentName.tsx`、`ComponentName/types.ts` 的目录规范
- 当 `__internal__` 中的组件还包含只服务于自身的专属子组件时，将专属子组件定义在父组件实现文件的模块顶层、置于导出组件之前，并保持不导出；不要为它继续创建嵌套的 `__internal__` 或新目录，也不要在父组件函数内部声明组件
- “专属”表示该子组件不会被同级组件或目录外代码复用；如果开始被多个组件使用，或需要独立 Story、测试和稳定 Props API，应提升为最近一层 `__internal__` 下的独立组件目录

```tsx
import type { DetailPanelProps } from './types';

interface PanelFooterProps {
  disabled: boolean;
  onConfirm: () => void;
}

function PanelFooter({ disabled, onConfirm }: PanelFooterProps) {
  return (
    <footer>
      <button disabled={disabled} type='button' onClick={onConfirm}>
        确认
      </button>
    </footer>
  );
}

export function DetailPanel({ disabled, onConfirm }: DetailPanelProps) {
  return (
    <section>
      <PanelFooter disabled={disabled} onConfirm={onConfirm} />
    </section>
  );
}
```

## 注释规范

- 所有代码注释必须使用中文；变量、函数、类型等标识符仍使用语义清晰的英文命名，并遵循现有命名规范
- 优先通过清晰的变量名和函数名实现自解释，减少不必要的注释
- 仅对不直观的业务逻辑、算法意图、非常规手段等添加多行注释，解释 **为什么** 这样做以及 **目的** 是什么
- 不为显而易见的代码添加注释（如 `// 获取用户列表` 加在 `getUserList()` 上）
- 函数和 TS interface 属性的说明均使用多行 JSDoc；函数内部的行内说明使用 `//`，内容较长时连续使用多行单行注释
- 函数或函数类型属性的参数需要说明时，使用 JSDoc 的 `@param parameterName 参数说明` 格式；不在 JSDoc 中重复 TypeScript 已表达的参数类型
- interface 属性只在需要补充业务含义、约束或副作用时添加注释；一旦添加，必须使用多行 JSDoc

  ```ts
  export interface SideNavProps {
    /**
     * 导航项切换完成后触发
     * @param routePath 目标路由路径
     */
    onSwitchNavTab: (routePath: string) => void;
  }
  ```

## Zustand 状态管理

- 仅将跨组件或跨路由共享的客户端状态放入 Zustand；局部状态使用 `useState` / `useReducer`，服务端数据、缓存、请求状态和 mutation 使用 TanStack Query
- 使用 `create<Store>()(...)` 创建类型安全的 store，明确分离 State 与 Actions，并将 action 与其状态放在同一 store 或 slice；大型 store 按业务领域拆分，避免巨型平面结构
- 组件必须通过 selector 精确订阅所需字段，禁止订阅整个 store；selector 返回对象或数组时，仅在确有必要时使用 `useShallow`
- 不存储可由现有状态计算的派生数据；默认使用不可变更新，仅在复杂嵌套更新时考虑 Immer
- 仅在需要跨刷新保留状态时使用 `persist`，通过 `partialize` 明确持久化字段并配置版本迁移；禁止持久化 token、密码等敏感数据
- `devtools` 等调试中间件仅在开发环境按需启用；实现应保持最小、清晰、可测试，不提前抽象，也不默认将状态提升到全局

## 其他

- 不强制添加错误边界（Error Boundary）
- 不强制添加 displayName

## 单元测试

- 除非明确要求，否则绝不主动添加单元测试
