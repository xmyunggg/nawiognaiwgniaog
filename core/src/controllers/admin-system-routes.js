const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { getDataFile } = require("../config/runtime-paths");

const LOGIN_ASSETS_DIR = getDataFile("login-assets");
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const HOME_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
]);

fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });

function createImageUpload(maxBytes) {
  return multer({
    storage: multer.diskStorage({
      destination: LOGIN_ASSETS_DIR,
      filename(req, file, callback) {
        callback(null, `${crypto.randomUUID()}${LOGIN_LOGO_EXTENSIONS.get(file.mimetype)}`);
      },
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter(req, file, callback) {
      if (!LOGIN_LOGO_EXTENSIONS.has(file.mimetype)) {
        return callback(new Error("仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片"));
      }
      return callback(null, true);
    },
  }).single("file");
}

const loginLogoUpload = createImageUpload(LOGIN_LOGO_MAX_BYTES);
const homeBackgroundUpload = createImageUpload(HOME_BACKGROUND_MAX_BYTES);

function deleteManagedLoginLogo(logoUrl) {
  const prefix = "/login-assets/";
  const value = String(logoUrl || "");
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(value.slice(prefix.length));
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
  } catch {}
}

function registerAdminSystemRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
  requireSuperAdminRole,
  requireDangerConfirmation,
  getDefaultSystemConfig,
  getRuntimeConfig,
  updateRuntimeConfig,
}) {
  const isAllowedPublicLink = (value) => {
    const link = String(value || "").trim();
    return (
      !link ||
      link.startsWith("/") ||
      /^https?:\/\//i.test(link) ||
      /^mqqapi:\/\//i.test(link)
    );
  };

  const isAllowedImageLink = (value) => {
    const link = String(value || "").trim();
    return !link || link.startsWith("/") || /^https?:\/\//i.test(link);
  };

  app.get(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({
          ok: true,
          data: {
            saved: store.getSystemConfig(),
            default: getDefaultSystemConfig(),
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/public/login-links", (req, res) => {
    try {
      res.json({ ok: true, data: store.getLoginLinks() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getLoginLinks() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_LOGIN_LINKS")) return;
        const body = req.body && typeof req.body === "object" ? req.body : {};
        if (!isAllowedImageLink(body.logoUrl)) {
          return res.status(400).json({ ok: false, error: "登录页LOGO地址不合法" });
        }
        if (!isAllowedImageLink(body.homeBackgroundUrl)) {
          return res.status(400).json({ ok: false, error: "全局背景图地址不合法" });
        }
        if (
          !isAllowedPublicLink(body.purchaseUrl) ||
          !isAllowedPublicLink(body.qqGroupUrl)
        ) {
          return res.status(400).json({ ok: false, error: "链接地址不合法" });
        }
        const current = store.getLoginLinks();
        const saved = store.setLoginLinks({
          logoUrl: String(body.logoUrl ?? current.logoUrl),
          homeBackgroundUrl: String(body.homeBackgroundUrl ?? current.homeBackgroundUrl),
          title: String(body.title ?? current.title).trim().slice(0, 60),
          loginSubtitle: String(body.loginSubtitle ?? current.loginSubtitle)
            .trim()
            .slice(0, 120),
          registerSubtitle: String(
            body.registerSubtitle ?? current.registerSubtitle,
          )
            .trim()
            .slice(0, 120),
          purchaseUrl: String(body.purchaseUrl ?? current.purchaseUrl).trim(),
          qqGroupUrl: String(body.qqGroupUrl ?? current.qqGroupUrl).trim(),
        });
        for (const key of ["logoUrl", "homeBackgroundUrl"]) {
          if (current[key] !== saved[key]) deleteManagedLoginLogo(current[key]);
        }
        logger.warn("更新登录页配置", {
          admin: req.currentUser?.username || "",
          confirmation: "UPDATE_LOGIN_LINKS",
        });
        res.json({ ok: true, data: saved });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_LOGIN_LINKS")) return;
        const current = store.getLoginLinks();
        const saved = store.setLoginLinks({
          logoUrl: "",
          homeBackgroundUrl: "",
          title: "",
          loginSubtitle: "",
          registerSubtitle: "",
          purchaseUrl: "",
          qqGroupUrl: "",
        });
        deleteManagedLoginLogo(current.logoUrl);
        deleteManagedLoginLogo(current.homeBackgroundUrl);
        logger.warn("重置登录页配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_LOGIN_LINKS",
        });
        res.json({ ok: true, data: saved });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-logo",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      loginLogoUpload(req, res, (error) => {
        if (error) {
          const message =
            error.code === "LIMIT_FILE_SIZE"
              ? "图片大小不能超过 2MB"
              : error.message || "上传失败";
          return res.status(400).json({ ok: false, error: message });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "未收到图片文件" });
        }
        try {
          const current = store.getLoginLinks();
          const saved = store.setLoginLinks({
            ...current,
            logoUrl: `/login-assets/${req.file.filename}`,
          });
          deleteManagedLoginLogo(current.logoUrl);
          res.json({ ok: true, data: saved });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e.message });
        }
      });
    },
  );

  app.post(
    "/api/admin/home-background",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      homeBackgroundUpload(req, res, (error) => {
        if (error) {
          const message =
            error.code === "LIMIT_FILE_SIZE"
              ? "图片大小不能超过 8MB"
              : error.message || "上传失败";
          return res.status(400).json({ ok: false, error: message });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "未收到图片文件" });
        }
        try {
          const current = store.getLoginLinks();
          const saved = store.setLoginLinks({
            ...current,
            homeBackgroundUrl: `/login-assets/${req.file.filename}`,
          });
          deleteManagedLoginLogo(current.homeBackgroundUrl);
          res.json({ ok: true, data: saved });
        } catch (e) {
          return res.status(500).json({ ok: false, error: e.message });
        }
      });
    },
  );

  app.post(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_SYSTEM_CONFIG")) return;
        const { serverUrl, clientVersion, platform, os, systemVersion, timezone } = req.body || {};
        const saved = store.setSystemConfig({
          serverUrl,
          clientVersion,
          platform,
          os,
          systemVersion,
          timezone,
        });
        updateRuntimeConfig(saved);
        logger.warn("更新系统配置", {
          admin: req.currentUser?.username || "",
          serverUrl: saved?.serverUrl || "",
          clientVersion: saved?.clientVersion || "",
          platform: saved?.platform || "",
          os: saved?.os || "",
          systemVersion: saved?.systemVersion || "",
          timezone: saved?.timezone || "",
          confirmation: "UPDATE_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_SYSTEM_CONFIG")) return;
        const saved = getDefaultSystemConfig();
        store.setSystemConfig(saved);
        updateRuntimeConfig(saved);
        logger.warn("重置系统配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

}

module.exports = { registerAdminSystemRoutes };
