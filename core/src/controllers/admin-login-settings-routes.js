/**
 * 登录设置路由（扫码登录方式 + NapCat 接口参数）。
 *
 * - `GET /api/login-settings`：添加账号弹窗读取可用的扫码方式（不返回签名）
 * - `GET /api/admin/login-settings`：管理员读取完整配置（含签名）
 * - `POST /api/admin/login-settings`：管理员保存
 */
function registerAdminLoginSettingsRoutes({
  app,
  store,
  requireAdminToken,
  requireAdminRole,
  requireDangerConfirmation,
}) {
  // 添加账号弹窗用：仅暴露两个开关，签名不下发
  app.get("/api/login-settings", (_req, res) => {
    try {
      const settings = store.getLoginSettings();
      res.json({
        ok: true,
        data: {
          wechatQrLogin: settings.wechatQrLogin,
          qqQrLogin: settings.qqQrLogin,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get(
    "/api/admin/login-settings",
    requireAdminToken,
    requireAdminRole,
    (_req, res) => {
      try {
        res.json({ ok: true, data: store.getLoginSettings() });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    },
  );

  app.post(
    "/api/admin/login-settings",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_LOGIN_SETTINGS")) return;
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const saved = store.setLoginSettings({
          wechatQrLogin: body.wechatQrLogin,
          qqQrLogin: body.qqQrLogin,
          napCatEndpoint: body.napCatEndpoint,
          napCatSignature: body.napCatSignature,
        });
        // 地址或签名变了，旧的 WebUI 凭证必须作废
        try {
          require("../services/napcat-login").resetCredential();
        } catch {}
        res.json({ ok: true, data: saved });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
      }
    },
  );
}

module.exports = { registerAdminLoginSettingsRoutes };
