/**
 * 登录日志路由（管理员专用）。
 */
const userStore = require("../models/user-store");

function registerAdminLoginLogRoutes({ app, requireAdminToken, requireAdminRole, requireDangerConfirmation }) {
  app.get("/api/admin/login-logs", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const limit = req.query.limit;
      const offset = req.query.offset;
      const result = userStore.getLoginLogs(limit, offset);
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/login-logs/clear", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "CLEAR_LOGIN_LOGS")) return;
      userStore.clearLoginLogs();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminLoginLogRoutes };
