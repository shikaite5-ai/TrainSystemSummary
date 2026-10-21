
(() => {
      "use strict";
      const NS = "http://www.w3.org/2000/svg";
      const graph = document.getElementById("graph");
      const content = document.createElementNS(NS, "g");
      content.id = "graphContent";
      graph.appendChild(content);
      const status = document.getElementById("status");
      const stage = document.getElementById("graphStage");
      const menu = document.getElementById("edgeAction");
      const menuTitle = document.getElementById("edgeActionTitle");
      const view = { width: 3300, height: 2050, scale: 1, x: 0, y: 0 };
      const nodeMap = new Map();
      const edgeMap = new Map();
      let selectedId = null;
      let activeEdge = null;

      const tables = {
        dataPlane: {
          headers: ["数据类型", "产生或维护步骤", "主要工作", "后续使用者", "生命周期", "图中节点"],
          rows: [
            ["原始样本 / prompt", "样本准备", "读取、解码、分词、筛选和打包", "输入张量、RL 轨迹", "进入当前 batch 后可释放或按数据集保留", "RAW"],
            ["输入张量", "输入搬运、前向", "携带 token、mask、位置和标签", "前向计算、损失计算", "当前 micro-batch", "IN"],
            ["预取与 DMA 缓冲", "输入准备、输入搬运", "在 CPU、PCIe/NVLink 和 GPU 之间搬运数据", "输入张量", "DMA 完成前必须保持有效，完成后复用", "BUF"],
            ["参数临时工作区", "前向、参数收集", "保存 AllGather 后的完整参数或格式转换结果", "当前模块前向", "当前模块计算期间", "PARAMBUF"],
            ["前向激活", "前向计算", "保存反向所需的中间值，或提供重计算依据", "反向传播", "对应反向完成前；也可卸载、重计算", "ACT"],
            ["logits / logprob", "前向计算", "形成预测结果或策略概率", "损失计算、RL 概率比", "当前样本的损失计算完成前", "LOGIT"],
            ["loss", "损失计算", "按有效 token、reward 或 advantage 计算训练目标", "反向传播", "当前训练步", "LOSS"],
            ["dX / dW", "反向传播", "将损失影响传回输入，并计算参数梯度", "梯度累积、梯度通信", "当前 micro-batch，进入累积后可释放局部副本", "GRAD"],
            ["梯度累积和", "梯度累积", "合并多个 micro-batch 的梯度，并维护有效 token 分母", "梯度通信、更新前检查", "一个全局 batch 或一次更新", "ACC"],
            ["梯度桶", "梯度通信", "按参数分组，支持通信与反向重叠", "AllReduce / ReduceScatter", "通信完成后释放或复用", "BUCKET"],
            ["归约后梯度", "梯度通信完成后", "得到完整梯度贡献或本卡负责的梯度分片", "梯度裁剪、优化器更新", "本次参数更新", "REDUCE"],
            ["RL 轨迹", "RL 生成、验证", "保存 prompt、回答 token、EOS、行为 logprob 和生成进度", "reward、advantage、策略损失", "训练、重放或恢复未完成轨迹期间", "RLTRAJ"],
            ["reward / advantage", "RL 验证、优势计算", "决定策略损失的方向和权重", "RL loss、反向传播", "对应轨迹完成训练前", "RLSTAT"],
            ["路由与版本记录", "RL 生成、MoE 路由", "记录 policy version、sampling config 和 expert ID，保证训推一致", "RL 训练、样本过滤、恢复", "对应轨迹训练完成或样本失效", "ROUTE"]
          ]
        },
        updateState: {
          headers: ["数据类型", "产生或维护步骤", "主要工作", "生命周期", "图中节点"],
          rows: [
            ["BF16 模型权重", "权重写回、下一步前向", "作为当前模型参与前向和反向", "跨训练步保留", "WBF"],
            ["FP32 主权重", "优化器更新", "作为高精度参数更新载体，减少低精度累积误差", "跨训练步保留", "WFP"],
            ["Adam 一阶矩 m", "优化器更新", "记录梯度的一阶历史", "跨训练步保留", "MOM1"],
            ["Adam 二阶矩 v", "优化器更新", "记录梯度平方的二阶历史", "跨训练步保留", "MOM2"],
            ["下一步 BF16 权重", "权重写回", "将更新后的主权重转换并同步为下一步可读格式", "直到下一次更新", "WNEW"],
            ["checkpoint 快照", "checkpoint 保存", "保存可恢复的权重、优化器状态和训练进度", "直到被更新版本替代", "CKDATA"]
          ]
        },
        controlPlane: {
          headers: ["控制数据", "影响步骤", "主要工作", "是否需要跨步保存", "图中节点"],
          rows: [
            ["数据进度", "样本准备、恢复", "确定 sampler、batch、打包器剩余 token 和恢复位置", "是", "CURSOR"],
            ["step / micro-batch 计数", "梯度累积、优化器更新", "决定累积边界、更新时机和训练进度", "是", "STEP"],
            ["RNG 状态", "样本准备、前向、反向", "保持采样、dropout 和数据顺序可复现", "是", "RNG"],
            ["学习率、loss scale、裁剪规则", "更新前检查、优化器更新", "决定梯度是否有效以及参数如何更新", "是", "RULE"],
            ["并行与分片布局", "前向、梯度通信、恢复", "决定参数收集、梯度归约和状态归属", "是", "PAR"],
            ["流水线与通信配置", "前向、反向、梯度通信", "决定激活驻留、重计算、卸载、通信桶和重叠策略", "通常需要保存或可重建", "SCHED"],
            ["policy version / checkpoint 提交状态", "RL、checkpoint、更新", "判断样本、权重和快照是否属于同一版本", "是", "VERSION"],
            ["恢复控制", "故障恢复", "选择一致快照并恢复权重、优化器、数据位置和 RNG", "故障时使用", "RECOVER"]
          ]
        },
        stepTable: {
          headers: ["步骤", "主要输入", "执行的工作", "主要产物", "需要暂时保留", "跨步保留状态"],
          rows: [
            ["1. 样本准备", "原始样本、数据进度、RNG", "读取、解码、分词、筛选、打包", "当前 micro-batch", "预取队列、打包器剩余 token", "数据进度、RNG"],
            ["2. 输入搬运", "输入张量、DMA 缓冲", "预取、DMA、H2D 搬运", "GPU 输入张量", "DMA 源缓冲直到传输完成", "并行布局、调度配置"],
            ["3. 前向计算", "GPU 输入、BF16 权重", "参数收集、矩阵计算、产生中间结果", "激活、logits", "当前层权重、参数临时工作区", "BF16 权重"],
            ["4. 损失计算", "logits、标签、reward、advantage", "对齐 token，按有效 token 或策略规则归一化", "loss", "logits 和损失统计", "step、损失规则"],
            ["5. 反向传播", "loss、激活、上游梯度", "反向读取激活，计算 dX 和 dW", "micro-batch 梯度", "尚未使用的激活、上游梯度", "无新增跨步状态"],
            ["6. 梯度累积", "dW、有效 token 数", "合并 micro-batch 梯度", "累积梯度和、统一分母", "累积梯度", "step、累积边界"],
            ["7. 梯度通信", "梯度桶、分片归属", "AllReduce / ReduceScatter、通信重叠", "归约后梯度", "通信缓冲和接收缓冲", "并行布局、通信配置"],
            ["8. 更新前检查", "归约后梯度、loss scale", "范数统计、溢出检查、梯度裁剪", "有效梯度或跳步标志", "范数和检查结果", "学习率、loss scale、裁剪规则"],
            ["9. 优化器更新", "梯度、FP32 主权重、m、v", "应用学习率、权重衰减和 Adam 更新", "新主权重、新 m、新 v", "优化器临时缓冲", "主权重、Adam 状态、step"],
            ["10. 权重写回", "新 FP32 主权重", "转换为 BF16、同步和分片写回", "下一步 BF16 权重", "格式转换缓冲", "BF16 权重"],
            ["11. 清理与恢复点", "已完成数据、checkpoint 状态", "释放激活和梯度，提交一致快照", "可复用缓冲、最近有效 checkpoint", "异步写入缓冲", "checkpoint、数据进度、RNG"]
          ]
        }
      };

      const nodes = [
        ["RAW", "原始样本", "prompt、文本、轨迹", "data", 130, 140], ["IN", "输入张量", "token、mask、位置", "data", 130, 300], ["BUF", "预取与 DMA 缓冲", "锁页主机缓冲、GPU 目标", "data", 130, 460], ["PARAMBUF", "参数临时工作区", "AllGather、格式转换", "data", 130, 620], ["ACT", "前向激活", "中间值、cache", "data", 130, 780], ["LOGIT", "logits / logprob", "预测值", "data", 130, 940], ["LOSS", "loss", "有效 token、reward", "data", 130, 1100], ["GRAD", "反向结果", "dX、dW", "data", 130, 1260],
        ["ACC", "梯度累积", "梯度和、有效 token", "data", 390, 140], ["BUCKET", "梯度桶", "通信缓冲、分片梯度", "data", 390, 300], ["REDUCE", "归约后梯度", "完整贡献或分片", "data", 390, 460], ["RLTRAJ", "RL 轨迹", "回答 token、EOS", "data", 390, 780], ["RLSTAT", "RL 统计", "reward、advantage", "data", 390, 940], ["ROUTE", "路由与版本记录", "policy、expert、sampling", "data", 390, 1100],
        ["PREP", "1. 样本准备", "", "step", 650, 120], ["H2D", "2. 输入搬运", "", "step", 650, 230], ["FWD", "3. 前向计算", "", "step", 650, 340], ["LC", "4. 损失计算", "", "step", 650, 450], ["BWD", "5. 反向传播", "", "step", 650, 560], ["GA", "6. 梯度累积", "", "step", 650, 670], ["COMM", "7. 梯度通信", "", "step", 650, 780], ["CHECK", "8. 更新前检查", "", "step", 650, 890], ["OPT", "9. 优化器更新", "", "step", 650, 1000], ["CAST", "10. 权重写回", "", "step", 650, 1110], ["NEXT", "11. 清理与下一步", "", "step", 650, 1220],
        ["WBF", "BF16 模型权重", "", "state", 990, 150], ["WFP", "FP32 主权重", "", "state", 990, 330], ["MOM1", "Adam 一阶矩 m", "", "state", 990, 510], ["MOM2", "Adam 二阶矩 v", "", "state", 990, 690], ["WNEW", "下一步 BF16 权重", "", "state", 990, 870], ["CKDATA", "Checkpoint 快照", "权重、状态、进度", "state", 990, 1080],
        ["CURSOR", "数据进度", "sampler、batch、剩余 token", "control", 1450, 120], ["STEP", "step 与 micro-batch 计数", "累积边界、训练进度", "control", 1450, 265], ["RNG", "RNG 状态", "采样、dropout、顺序", "control", 1450, 410], ["RULE", "优化规则", "学习率、loss scale、裁剪", "control", 1450, 555], ["PAR", "并行与分片布局", "DP、TP、PP、EP", "control", 1450, 700], ["SCHED", "调度与通信配置", "流水线、桶、重计算", "control", 1450, 845], ["VERSION", "版本控制", "policy、checkpoint 提交", "control", 1450, 990], ["RECOVER", "恢复控制", "快照选择、恢复位置", "control", 1450, 1135]
      ].map(([id, title, detail, kind, x, y]) => ({ id, title, detail, kind, x, y, w: kind === "control" ? 290 : 220, h: detail ? 66 : 48 }));
      // Keep the four Mermaid lanes in the same left-to-right order, but give
      // each lane enough room for long labels and cross-lane relationships.
      const xLayout = { 130: 300, 390: 700, 650: 1200, 990: 1750, 1450: 2700 };
      nodes.forEach(node => {
        node.x = xLayout[node.x] ?? node.x;
        node.y = 80 + node.y * 1.38;
        node.w = node.kind === "control" ? 400 : node.kind === "state" ? 350 : node.kind === "step" ? 310 : 270;
        node.h = node.detail ? 78 : 56;
        nodeMap.set(node.id, node);
      });

      const edges = [
        ["RAW", "PREP", "读取、解码、分词、筛选、打包"], ["PREP", "BUF", "写入预取和锁页缓冲"], ["BUF", "H2D", "以 DMA 搬运到 GPU"], ["H2D", "IN", "交付 GPU 输入张量"], ["IN", "FWD", "启动当前模块前向"], ["WBF", "PARAMBUF", "按分片提供本地权重"], ["PARAMBUF", "FWD", "AllGather 后供当前模块读取"], ["FWD", "ACT", "保存或标记可重计算的中间结果"], ["FWD", "LOGIT", "产生预测值"], ["LOGIT", "LC", "对齐标签并计算有效 token loss"], ["LC", "LOSS", "产生归一化损失"], ["LOSS", "BWD", "把损失梯度传入反向"], ["ACT", "BWD", "按反向顺序读取或重计算"], ["BWD", "GRAD", "传播输入梯度并产生参数梯度"], ["GRAD", "GA", "按 micro-batch 相加并累计分母"], ["GA", "ACC", "形成梯度累积和"], ["ACC", "BUCKET", "按参数分组装入通信缓冲"], ["BUCKET", "COMM", "跨设备归约并按分片分配"], ["COMM", "REDUCE", "得到本次更新梯度"], ["REDUCE", "CHECK", "计算范数、检查溢出并裁剪"], ["CHECK", "OPT", "通过检查则提交有效梯度"], ["WFP", "OPT", "提供高精度参数"], ["MOM1", "OPT", "提供一阶历史"], ["MOM2", "OPT", "提供二阶历史"], ["OPT", "WFP", "更新主权重和优化器历史"], ["OPT", "MOM1", "更新一阶矩"], ["OPT", "MOM2", "更新二阶矩"], ["WFP", "CAST", "格式转换、同步和分片写回"], ["CAST", "WNEW", "生成下一步可读权重"], ["WNEW", "WBF", "替换当前模型权重"], ["NEXT", "PREP", "开始下一轮输入和前向"],
        ["CURSOR", "PREP", "确定下一批数据和恢复位置", true], ["RNG", "PREP", "决定随机采样、dropout 和数据顺序", true], ["RNG", "FWD", "提供前向和反向随机状态", true], ["STEP", "GA", "决定 micro-batch 累积边界", true], ["STEP", "OPT", "推进全局训练步", true], ["RULE", "CHECK", "提供 loss scale 和裁剪规则", true], ["RULE", "OPT", "提供学习率和权重衰减", true], ["PAR", "PARAMBUF", "决定参数分片和收集方式", true], ["PAR", "COMM", "决定梯度通信组和归约结果", true], ["SCHED", "FWD", "决定流水线、激活驻留、重计算和卸载", true], ["SCHED", "COMM", "决定通信桶和通信重叠", true], ["VERSION", "CHECK", "判断样本、权重和快照是否匹配", true], ["VERSION", "CAST", "记录更新后的策略版本", true],
        ["WBF", "RLTRAJ", "按当前策略生成回答"], ["ROUTE", "RLTRAJ", "约束采样配置、版本和专家路由"], ["RLTRAJ", "RLSTAT", "交给验证器计算结果"], ["RLSTAT", "LOSS", "生成策略损失的权重和方向"], ["RLTRAJ", "IN", "重建 token、mask、位置和 EOS"], ["ROUTE", "BWD", "检查训推 token、版本和路由一致性", true],
        ["ACT", "NEXT", "反向完成后释放、卸载或复用", true], ["BUCKET", "NEXT", "通信完成后释放或复用", true], ["REDUCE", "NEXT", "更新完成后清理本步梯度", true], ["WBF", "CKDATA", "写入当前模型权重快照"], ["WFP", "CKDATA", "写入 FP32 主权重快照"], ["MOM1", "CKDATA", "写入一阶历史"], ["MOM2", "CKDATA", "写入二阶历史"], ["STEP", "CKDATA", "写入训练步和累积进度"], ["CURSOR", "CKDATA", "写入数据读取位置"], ["RNG", "CKDATA", "写入随机状态"], ["PAR", "CKDATA", "写入并行布局和分片映射"], ["RULE", "CKDATA", "保存学习率和更新规则", true], ["CKDATA", "VERSION", "提交后成为最近有效版本"], ["VERSION", "RECOVER", "故障时选择一致快照"], ["RECOVER", "WBF", "恢复权重、优化器、数据位置和 RNG"], ["RECOVER", "STEP", "恢复训练进度和更新规则"], ["RECOVER", "CURSOR", "恢复样本读取位置"]
      ].map((entry, index) => ({ source: entry[0], target: entry[1], label: typeof entry[2] === "string" ? entry[2] : "", dashed: entry[3] === true, id: `edge-${index}`, routeSlot: index }));
      edges.forEach(edge => edgeMap.set(edge.id, edge));

      function el(tag, attrs, parent = content) {
        const item = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([key, value]) => item.setAttribute(key, value));
        parent.appendChild(item);
        return item;
      }
      function text(parent, value, attrs) { const item = el("text", attrs, parent); item.textContent = value; return item; }
      function color(kind) {
        return { data: ["#e8f3ff", "#1976d2"], step: ["#fff4d6", "#d08a00"], state: ["#e8f5e9", "#2e7d32"], control: ["#f3e8ff", "#7b1fa2"] }[kind];
      }
      function drawDefs() {
        const defs = el("defs", {});
        const marker = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
        el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#61758e" }, marker);
        const filter = el("filter", { id: "selectedShadow", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
        el("feDropShadow", { dx: "0", dy: "2", stdDeviation: "3", floodColor: "#f08a24", floodOpacity: ".45" }, filter);
        const glow = el("filter", { id: "flashGlow", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
        el("feGaussianBlur", { stdDeviation: "2", result: "blur" }, glow);
        const merge = el("feMerge", {}, glow); el("feMergeNode", { in: "blur" }, merge); el("feMergeNode", { in: "SourceGraphic" }, merge);
      }
      function drawGroup(x, y, w, h, title) { el("rect", { x, y, width: w, height: h, rx: 12, class: "subgraph" }); text(content, title, { x: x + 16, y: y + 29, class: "subgraph-title" }); }
      const layoutColumns = [300, 700, 1200, 1750, 2700];
      // Each inter-lane gap gets its own narrow vertical channels. Long-range
      // dependencies leave the node field through a dedicated top/bottom loop.
      const routeChannels = [500, 950, 1465, 2200];
      const routeGroups = new Map();
      function columnOf(x) {
        let best = 0, distance = Infinity;
        layoutColumns.forEach((column, index) => {
          const current = Math.abs(column - x);
          if (current < distance) { best = index; distance = current; }
        });
        return best;
      }
      function addRouteGroup(key, edge) {
        if (!routeGroups.has(key)) routeGroups.set(key, []);
        routeGroups.get(key).push(edge);
      }
      edges.forEach(edge => {
        const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target);
        const sourceColumn = columnOf(source.x), targetColumn = columnOf(target);
        const direction = targetColumn >= sourceColumn ? 1 : -1;
        edge.sourceColumn = sourceColumn;
        edge.targetColumn = targetColumn;
        edge.direction = direction;
        if (sourceColumn === targetColumn) {
          edge.routeKind = "same";
          edge.routeSide = edge.routeSlot % 2 ? -1 : 1;
          addRouteGroup(`same:${sourceColumn}:${edge.routeSide}`, edge);
        } else if (Math.abs(targetColumn - sourceColumn) === 1) {
          edge.routeKind = "gap";
          edge.gap = Math.min(sourceColumn, targetColumn);
          addRouteGroup(`gap:${edge.gap}:${direction}`, edge);
        } else {
          edge.routeKind = "outer";
          edge.outerSide = edge.routeSlot % 2 ? "bottom" : "top";
          addRouteGroup(`outer:${edge.outerSide}:${direction}`, edge);
        }
      });
      routeGroups.forEach(group => {
        group.forEach((edge, index) => {
          edge.routeOffset = (index - (group.length - 1) / 2) * 18;
        });
      });
      function routePath(edge, source, target) {
        const direction = edge.direction;
        const startX = source.x + direction * source.w / 2;
        const endX = target.x - direction * target.w / 2;
        if (edge.routeKind === "same") {
          const outer = edge.routeSide * (Math.max(source.w, target.w) / 2 + 92 + Math.abs(edge.routeOffset));
          const sideX = source.x + outer;
          return {
            d: `M ${startX} ${source.y} H ${sideX} V ${target.y} H ${endX}`,
            labelX: sideX + (edge.routeSide * 8), labelY: (source.y + target.y) / 2 - 8
          };
        }
        if (edge.routeKind === "gap") {
          const channel = routeChannels[edge.gap] + edge.routeOffset;
          return {
            d: `M ${startX} ${source.y} H ${channel} V ${target.y} H ${endX}`,
            labelX: channel, labelY: (source.y + target.y) / 2 - 8
          };
        }
        const outerY = edge.outerSide === "top"
          ? 92 + edge.routeOffset
          : 1940 + edge.routeOffset;
        const sourceStub = source.x + direction * (source.w / 2 + 82);
        const targetStub = target.x - direction * (target.w / 2 + 82);
        return {
          d: `M ${startX} ${source.y} H ${sourceStub} V ${outerY} H ${targetStub} V ${target.y} H ${endX}`,
          labelX: (sourceStub + targetStub) / 2, labelY: outerY - 8
        };
      }      function drawEdge(edge) {
        const source = nodeMap.get(edge.source), target = nodeMap.get(edge.target);
        if (!source || !target) return;
        const route = routePath(edge, source, target);
        const group = el("g", { class: "edge-group", "data-edge-id": edge.id });
        const hit = el("path", { d: route.d, id: edge.id, class: "edge-hit" }, group);
        hit.dataset.edgeId = edge.id;
        const visible = el("path", { d: route.d, class: `edge-visible${edge.dashed ? " dashed" : ""}` }, group);
        visible.dataset.edgeId = edge.id;
        if (edge.label) {
          const label = edge.label.length > 23 ? edge.label.slice(0, 23) + "…" : edge.label;
          text(group, label, { x: route.labelX, y: route.labelY, class: "edge-label" });
        }
      }      function drawNode(node) {
        const group = el("g", { class: "node-group", "data-node-id": node.id });
        group.dataset.nodeId = node.id;
        const [fill, stroke] = color(node.kind);
        el("rect", { x: node.x - node.w / 2, y: node.y - node.h / 2, width: node.w, height: node.h, fill, stroke, class: "node-box" }, group);
        if (node.detail) { text(group, node.title, { x: node.x, y: node.y - 6, class: "node-label" }); text(group, node.detail, { x: node.x, y: node.y + 15, class: "node-detail" }); }
        else text(group, node.title, { x: node.x, y: node.y + 5, class: "node-label" });
        el("rect", { x: node.x - node.w / 2 - 7, y: node.y - node.h / 2 - 7, width: node.w + 14, height: node.h + 14, rx: 12, class: "focus-ring", "data-ring-for": node.id });
      }
      function drawGraph() {
        drawDefs();
        drawGroup(30, 35, 915, 1980, "数据平面：当前样本和当前训练步");
        drawGroup(960, 35, 400, 1980, "步骤");
        drawGroup(1400, 35, 650, 1980, "更新状态：跨步保留");
        drawGroup(2090, 35, 1180, 1980, "控制平面：决定何时、如何以及是否执行");
        edges.forEach(drawEdge);
        nodes.forEach(drawNode);
      }
      function renderTable(id, spec) {
        const table = document.getElementById(id);
        const thead = document.createElement("thead"), headRow = document.createElement("tr");
        spec.headers.forEach(header => { const th = document.createElement("th"); th.textContent = header; headRow.appendChild(th); });
        thead.appendChild(headRow); table.appendChild(thead);
        const tbody = document.createElement("tbody");
        spec.rows.forEach(row => {
          const tr = document.createElement("tr");
          row.forEach((value, index) => {
            const td = document.createElement("td");
            if (index === row.length - 1 && nodeMap.has(value)) {
              const button = document.createElement("button"); button.type = "button"; button.className = "focus-link"; button.dataset.focusNode = value; button.textContent = value; td.appendChild(button);
            } else td.textContent = value;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
      }
      function setTransform() { content.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`); }
      function nodeCenter(id) { const node = nodeMap.get(id); return node ? { x: node.x, y: node.y } : null; }
      function focusNode(id, edgeId = null) {
        const point = nodeCenter(id); if (!point) return;
        selectedId = id; view.scale = Math.max(view.scale, 1.65); view.x = view.width / 2 - point.x * view.scale; view.y = view.height / 2 - point.y * view.scale; setTransform();
        document.querySelectorAll(".node-group.selected").forEach(item => item.classList.remove("selected"));
        document.querySelector(`.node-group[data-node-id="${CSS.escape(id)}"]`)?.classList.add("selected");
        document.querySelectorAll(".focus-ring.show").forEach(item => item.classList.remove("show"));
        document.querySelector(`.focus-ring[data-ring-for="${CSS.escape(id)}"]`)?.classList.add("show");
        status.textContent = `已聚焦：${nodeMap.get(id).title}（${id}）`;
        document.getElementById("graphShell").scrollIntoView({ behavior: "smooth", block: "center" });
        if (edgeId) flashEdge(edgeId);
      }
      function flashEdge(edgeId) {
        const hit = document.getElementById(edgeId); if (!hit) return;
        const group = hit.closest(".edge-group");
        hit.classList.remove("flash"); group?.classList.remove("label-visible");
        void hit.getBoundingClientRect();
        hit.classList.add("flash"); group?.classList.add("label-visible");
        window.setTimeout(() => {
          hit.classList.remove("flash");
          group?.classList.remove("label-visible");
        }, 1000);
      }
      function resetView() {
        view.scale = 1; view.x = 0; view.y = 0; selectedId = null; setTransform();
        document.querySelectorAll(".node-group.selected, .focus-ring.show").forEach(item => item.classList.remove("selected", "show"));
        status.textContent = "当前为全局视图"; closeMenu();
      }
      function closeMenu() {
        menu.classList.remove("open");
        document.querySelectorAll(".edge-group.label-visible").forEach(item => item.classList.remove("label-visible"));
        activeEdge = null;
      }
      function openMenu(edge, event) {
        if (!edge) return;
        activeEdge = edge;
        document.querySelectorAll(".edge-group.label-visible").forEach(item => item.classList.remove("label-visible"));
        document.querySelector(`.edge-group[data-edge-id="${CSS.escape(edge.id)}"]`)?.classList.add("label-visible");
        menuTitle.textContent = `${nodeMap.get(edge.source).id} → ${nodeMap.get(edge.target).id}`;
        const bounds = stage.getBoundingClientRect();
        menu.style.left = `${Math.min(Math.max(8, event.clientX - bounds.left + 8), bounds.width - 270)}px`;
        menu.style.top = `${Math.min(Math.max(8, event.clientY - bounds.top + 8), bounds.height - 150)}px`;
        menu.classList.add("open");
      }
      // Pan the complete SVG with the mouse or touch. Interactive nodes and
      // arrows keep their click semantics; blank canvas is the pan surface.
      const pan = { active: false, moved: false, pointerId: null, x: 0, y: 0, startX: 0, startY: 0, downTarget: null };
      graph.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        pan.active = true; pan.moved = false; pan.pointerId = event.pointerId;
        pan.startX = event.clientX; pan.startY = event.clientY; pan.x = view.x; pan.y = view.y;
        // Pointer capture can retarget the eventual click to the SVG root.
        // Keep the element that was actually pressed for click handling.
        pan.downTarget = event.target;
        graph.classList.add("is-panning"); graph.setPointerCapture?.(event.pointerId);
        closeMenu(); event.preventDefault();
      });
      graph.addEventListener("pointermove", event => {
        if (!pan.active || event.pointerId !== pan.pointerId) return;
        const dx = event.clientX - pan.startX, dy = event.clientY - pan.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        const bounds = graph.getBoundingClientRect();
        view.x = pan.x + dx * view.width / bounds.width;
        view.y = pan.y + dy * view.height / bounds.height;
        setTransform(); event.preventDefault();
      });
      function stopPan(event) {
        if (!pan.active || (event && event.pointerId !== pan.pointerId)) return;
        pan.active = false; graph.classList.remove("is-panning");
        if (event) graph.releasePointerCapture?.(event.pointerId);
      }
      graph.addEventListener("pointerup", stopPan);
      graph.addEventListener("pointercancel", stopPan);

      graph.addEventListener("wheel", event => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const bounds = graph.getBoundingClientRect();
        const pointerX = (event.clientX - bounds.left) / bounds.width * view.width;
        const pointerY = (event.clientY - bounds.top) / bounds.height * view.height;
        const beforeX = (pointerX - view.x) / view.scale;
        const beforeY = (pointerY - view.y) / view.scale;
        const factor = Math.exp(-event.deltaY * 0.0015);
        const nextScale = Math.min(3.4, Math.max(0.65, view.scale * factor));
        view.scale = nextScale;
        view.x = pointerX - beforeX * nextScale;
        view.y = pointerY - beforeY * nextScale;
        setTransform();
      }, { passive: false });
      graph.addEventListener("click", event => {
        if (pan.moved) {
          pan.moved = false; pan.downTarget = null;
          event.preventDefault(); event.stopPropagation(); return;
        }
        // With pointer capture, event.target may be the SVG root rather than
        // the node/path under the pointer. Prefer it, then use the press target.
        const target = event.target?.closest ? event.target : pan.downTarget;
        const node = target?.closest?.(".node-group");
        if (node) {
          pan.downTarget = null;
          event.preventDefault(); closeMenu(); focusNode(node.dataset.nodeId); return;
        }
        const hit = target?.closest?.(".edge-hit");
        if (hit) {
          pan.downTarget = null;
          event.preventDefault(); event.stopPropagation(); openMenu(edgeMap.get(hit.dataset.edgeId), event); return;
        }
        pan.downTarget = null;
        closeMenu();
      });
      menu.addEventListener("click", event => {
        const action = event.target.closest?.("button")?.dataset.action;
        if (!action || !activeEdge) return;
        if (action === "close") { closeMenu(); return; }
        const target = action === "upstream" ? activeEdge.source : activeEdge.target;
        const edgeId = activeEdge.id; closeMenu(); focusNode(target, edgeId);
      });
      document.addEventListener("click", event => {
        const button = event.target.closest?.("button[data-focus-node]");
        if (!button) return;
        event.preventDefault(); focusNode(button.dataset.focusNode);
      });
      document.getElementById("reset").addEventListener("click", resetView);
      document.getElementById("zoomIn").addEventListener("click", () => { view.scale = Math.min(3.4, view.scale + .15); setTransform(); });
      document.getElementById("zoomOut").addEventListener("click", () => { view.scale = Math.max(.65, view.scale - .15); setTransform(); });
      window.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); if (event.key === "0") resetView(); });

      drawGraph();
      Object.entries(tables).forEach(([id, spec]) => renderTable(id, spec));
      setTransform();
    })();
