/**
 * 代理（分销）系统路由。
 *
 * - `/api/admin/agents*`、`/api/admin/agent-specs*`：管理员管理代理与发卡规格
 * - `/api/agent/*`：代理登录后自助发卡、查看自己发出的卡密与客户
 *
 * 代理本身是 role='agent' 的用户记录，卡密记录 createdBy（代理名）与 creatorRole='agent'，
 * 使用该卡注册/续费的用户写入 usedBy，配合 createdBy 实现客户归属与对账。
 */
const userStore = require("../models/user-store");

function registerAdminAgentRoutes({
  app,
  requireAdminToken,
  requireAdminRole,
  requireAgentRole,
  requireDangerConfirmation,
  updateAdminSessions,
  invalidateAdminSessions,
  logger,
}) {
  const log = (message, meta) => {
    try {
      logger?.info?.(message, meta);
    } catch {
      // 日志失败不影响业务流程
    }
  };

  // ==================== 管理员：发卡规格 ====================

  app.get("/api/admin/agent-specs", requireAdminToken, requireAdminRole, (_req, res) => {
    try {
      res.json({ ok: true, data: userStore.getAllAgentSpecs().map(userStore.publicAgentSpec) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/agent-specs", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "CREATE_AGENT_SPEC")) return;
      const result = userStore.createAgentSpec(req.body || {});
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true, data: userStore.publicAgentSpec(result.spec) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/agent-specs/:id", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "UPDATE_AGENT_SPEC")) return;
      const result = userStore.updateAgentSpec(req.params.id, req.body || {});
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true, data: userStore.publicAgentSpec(result.spec) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/admin/agent-specs/:id", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "DELETE_AGENT_SPEC")) return;
      const result = userStore.deleteAgentSpec(req.params.id);
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ==================== 管理员：代理管理 ====================

  app.get("/api/admin/agents", requireAdminToken, requireAdminRole, (_req, res) => {
    try {
      res.json({ ok: true, data: userStore.getAllAgents() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/agents", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "CREATE_AGENT")) return;
      const result = userStore.createAgent(req.body || {});
      if (!result.ok) return res.status(400).json(result);
      log("创建代理", { username: result.agent.username });
      res.json({ ok: true, data: result.agent });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/agents/:username/edit", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "EDIT_AGENT")) return;
      const { username } = req.params;
      const result = userStore.editAgent(username, req.body || {});
      if (!result.ok) return res.status(400).json(result);

      // 改名后同步在线会话里的用户名
      if (result.agent.username !== username && typeof updateAdminSessions === "function") {
        updateAdminSessions(
          (session) => session.username === username,
          (session) => {
            session.username = result.agent.username;
          }
        );
      }
      // 停用后立即踢下线
      if (result.agent.enabled === false && typeof invalidateAdminSessions === "function") {
        invalidateAdminSessions((session) => session.username === result.agent.username);
      }
      log("更新代理", { username: result.agent.username, enabled: result.agent.enabled });
      res.json({ ok: true, data: result.agent });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/admin/agents/:username", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "DELETE_AGENT")) return;
      const { username } = req.params;
      const result = userStore.deleteAgent(username);
      if (!result.ok) return res.status(400).json(result);
      if (typeof invalidateAdminSessions === "function") {
        invalidateAdminSessions((session) => session.username === username);
      }
      log("删除代理", { username });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/agents/:username/stats", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const stats = userStore.getAgentStats(req.params.username);
      if (!stats) return res.status(404).json({ ok: false, error: "代理不存在" });
      res.json({ ok: true, data: stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/agents/:username/cards", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!userStore.getAgent(req.params.username)) {
        return res.status(404).json({ ok: false, error: "代理不存在" });
      }
      res.json({ ok: true, data: userStore.getCardsByCreator(req.params.username) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/agents/:username/customers", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!userStore.getAgent(req.params.username)) {
        return res.status(404).json({ ok: false, error: "代理不存在" });
      }
      res.json({ ok: true, data: userStore.getAgentCustomers(req.params.username) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ==================== 管理员：代理充值卡 ====================

  app.get("/api/admin/agent-recharge-cards", requireAdminToken, requireAdminRole, (_req, res) => {
    try {
      res.json({ ok: true, data: userStore.getAllAgentRechargeCards() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/agent-recharge-cards", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "CREATE_AGENT_RECHARGE_CARDS")) return;
      const { amount, count, description } = req.body || {};
      const result = userStore.createAgentRechargeCards({
        amount,
        count,
        description,
        createdBy: req.currentUser?.username,
      });
      if (!result.ok) return res.status(400).json(result);
      log("生成代理充值卡", {
        amount: result.amount,
        count: result.count,
        operator: req.currentUser?.username,
      });
      res.json({ ok: true, data: { cards: result.cards, count: result.count, amount: result.amount } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/admin/agent-recharge-cards/:code", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "DELETE_AGENT_RECHARGE_CARD")) return;
      const result = userStore.deleteAgentRechargeCard(req.params.code);
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ==================== 代理：自助发卡 ====================

  app.get("/api/agent/me", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      const self = userStore.getAgentSelf(req.currentUser.username);
      if (!self) return res.status(404).json({ ok: false, error: "代理不存在" });
      res.json({ ok: true, data: self });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/agent/stats", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      const stats = userStore.getAgentStats(req.currentUser.username);
      if (!stats) return res.status(404).json({ ok: false, error: "代理不存在" });
      res.json({ ok: true, data: stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/agent/specs", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      const self = userStore.getAgent(req.currentUser.username);
      if (!self) return res.status(404).json({ ok: false, error: "代理不存在" });

      const all = userStore.getAllAgentSpecs().filter((spec) => spec.enabled);
      const allowed = Array.isArray(self.specIds) && self.specIds.length > 0
        ? all.filter((spec) => self.specIds.includes(spec.id))
        : all;
      res.json({ ok: true, data: allowed.map(userStore.publicAgentSpec) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/agent/cards", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      res.json({ ok: true, data: userStore.getCardsByCreator(req.currentUser.username) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/agent/customers", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      res.json({ ok: true, data: userStore.getAgentCustomers(req.currentUser.username) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/agent/cards", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      const { specId, count, description } = req.body || {};
      const result = userStore.generateAgentCards(req.currentUser.username, {
        specId,
        count,
        description,
      });
      if (!result.ok) return res.status(400).json(result);
      log("代理发卡", {
        username: req.currentUser.username,
        specId,
        count: result.count,
      });
      res.json({
        ok: true,
        data: {
          cards: result.cards,
          cost: result.cost,
          unitPrice: result.unitPrice,
          agent: result.agent,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/agent/recharge-records", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      res.json({ ok: true, data: userStore.getAgentRechargeRecords(req.currentUser.username) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/agent/recharge", requireAdminToken, requireAgentRole, (req, res) => {
    try {
      const { code } = req.body || {};
      const result = userStore.redeemAgentRechargeCard(req.currentUser.username, code);
      if (!result.ok) return res.status(400).json(result);
      log("代理充值", {
        username: req.currentUser.username,
        amount: result.amount,
        balance: result.balance,
      });
      res.json({ ok: true, data: { amount: result.amount, balance: result.balance, agent: result.agent } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminAgentRoutes };
