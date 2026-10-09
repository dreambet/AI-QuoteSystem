# 工序堆叠卡片视觉核对

- Source visual truth: `C:\Users\NB0148\AppData\Local\Temp\codex-clipboard-a2026c59-a4fe-4251-8979-0200605a0c34.png`
- Implementation evidence: Codex in-app browser, `http://localhost:3000/quotes/ai-new?resume=mubza5z9r1nqphhun5&step=3`
- Viewport/state: desktop；第 3 步；5 项候选工序；折叠与展开状态均已检查。

## Comparison

- Typography: 保留系统的等宽小标签、青色工艺摘要和清晰的工序名称层级；未复用参考图中的金融文案或暖色文字。
- Spacing and layout rhythm: 折叠时使用四张真实内容卡片，每张向下错开 24px，形成参考图相同的层叠节奏；展开时完整列表在同一容器下方展开，采纳按钮不被遮挡。
- Colors and visual tokens: 使用系统深海军蓝背景、青色描边、绿色时长，未引入参考图的粉橙配色。
- Image quality and asset fidelity: 参考图仅用于卡片堆叠布局，没有需要复用的图像资产。
- Copy and content: 卡片显示真实的工序序号、名称和建议分钟数；展开后显示依据、公式和采纳操作。

## Interaction verification

- 点击折叠组后，`details` 状态从 collapsed 变为 expanded。
- 展开后 5 项建议工序及各自采纳按钮均可见。

## Findings

- 无 P0/P1/P2 问题。

## Comparison history

- 初次实现将每项工序单独折叠，与参考图的整体层叠卡组不一致。
- 已改为单一工序卡组：折叠状态展示多张交错摘要卡，点击后展开完整工序列表。

final result: passed
