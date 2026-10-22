/**
 * 联系客服配置路由。
 *
 * - `GET /api/support-config`：公开读取（用户端悬浮入口用），只返回已启用时的配置
 * - `POST /api/admin/support-config`：管理员保存配置
 */
function registerAdminSupportRoutes({
  app,
  store,
  requireAdminToken,
  requireAdminRole,
  requireDangerConfirmation,
}) {
  app.get("/api/support-config", requireAdminToken, (_req, res) => {
    try {
      const config = store.getSupportConfig();
      if (!config.enabled) {
        return res.json({ ok: true, data: { enabled: false } });
      }
      res.json({ ok: true, data: config });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/support-config", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "UPDATE_SUPPORT_CONFIG")) return;
      const saved = store.setSupportConfig(req.body || {});
      if (!saved) return res.status(400).json({ ok: false, error: "配置无效" });
      res.json({ ok: true, data: saved });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminSupportRoutes };
