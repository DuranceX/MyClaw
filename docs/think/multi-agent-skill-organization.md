# Multi-Agent 系统中 Skill 的组织与共享设计

## 1. 背景与核心概念

在构建 Multi-Agent 系统时，一个核心挑战是如何合理地组织和管理 **Skill（技能）**，特别是在多个 Agent 之间存在**部分 Skill 交集**的情况下。

### Agent vs Skill 的本质区别

- **Skill**：原子能力、单一工具（如查邮件、天气查询、需求分析）。
- **Agent**：具备推理、规划能力的智能体，它通过调用多个 Skill 来完成复杂任务。
- Agent 可以看作是“会使用这些技能的大脑”，而非简单地把所有 Skill 堆在一起。

**核心设计目标**：
- 职责清晰（Role Specialization）
- 减少决策干扰
- 节省 Token 消耗
- 便于维护和扩展
- 安全性（最小权限原则）

---

## 2. 共享 Skill 的设计方案

### 2.1 推荐方案：领域功能组（Domain Functional Groups）

**核心原则**：**按能力领域划分组，而不是严格按 Agent 交集建组**。

#### 推荐目录结构

```
.skills/
├── core/                    # 所有 Agent 都必须加载的基础能力
│   ├── basic-chat
│   ├── memory-management
│   └── self-reflection

├── search/                  # 搜索与信息获取域
│   ├── web-search
│   ├── knowledge-base
│   └── academic-search

├── analysis/                # 分析与总结域
│   ├── data-analysis
│   ├── requirement-review
│   └── risk-assessment

├── execution/               # 执行操作域
│   ├── code-execution
│   ├── cloud-mail
│   ├── api-caller
│   └── file-operation

├── communication/           # 沟通与输出域
│   ├── notification
│   └── report-generation

└── specialized/             # 高度个性化、不适合放入组的 Skill
    ├── agentA-exclusive-xxx
    └── agentB-exclusive-yyy
```

### 2.2 Agent 能力配置文件示例（agent_roles.yaml）

```yaml
agents:
  Researcher:                    # 研究员
    groups: [core, search, analysis]
    skills: []                   # 可额外单独挂载少量 Skill

  Executor:                      # 执行者
    groups: [core, execution, communication]
    skills: [cloud-mail]

  Reviewer:                      # 审核者
    groups: [core, analysis]
    skills: []

  Planner:                       # 规划者
    groups: [core, search]
    skills: []
```

---

## 3. 如何避免“分组爆炸”问题

### 常见陷阱
如果严格按照“任何两个 Agent 的交集都新建一个组”，很容易产生大量只包含 1~2 个 Skill 的碎片化小组，导致维护困难。

### 解决策略

1. **按领域而非交集分组**：把相关 Skill 归类到同一领域组（如 `analysis/`）。
2. **控制组的数量**：整个系统建议将功能组控制在 **5~8 个以内**。
3. **少量特殊 Skill 直接挂载**：当交集很小（仅 1~2 个 Skill）时，不必单独建组，可直接在 Agent 配置中声明。
4. **组合优于继承**：Agent 可同时挂载多个组（Composition over Inheritance）。
5. **Core 组永远共享**：所有 Agent 都包含基础能力。

---

## 4. 设计原则总结

- **最小够用原则**：每个 Agent 只加载它真正需要的 Skill，减少 Token 浪费和决策干扰。
- **领域内聚性**：同一个组内的 Skill 应具有较强的相关性。
- **可维护性优先**：避免重复定义 Skill 描述，统一通过组管理。
- **渐进式演化**：早期 Skill 少时可简单分组，后期 Skill 增多后再引入标签系统。
- **当 Skill 总数 > 20 个** 时，可考虑升级为 **Skill 标签系统**（Tag-based Injection）。

---

## 5. 未来可扩展方向

- 实现动态 Skill 注入引擎（根据配置自动生成 Prompt）
- 引入 Skill 权限标签（security、read-only、dangerous 等）
- 开发可视化工具展示 Agent-Skill 关系矩阵
- 支持 Agent 之间的 Skill 借用协议（需审核）

---

**文档目的**：作为本项目 Multi-Agent 架构设计时的参考文档。

**更新记录**：
- 创建日期：2025 年（基于对话记录）
- 作者：AI Assistant（与用户共同讨论整理）
- 版本：v1.0

