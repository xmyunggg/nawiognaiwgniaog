<script setup lang="ts">
import type { Theme } from '@/stores/app'
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const adminToken = useStorage('admin_token', '')

// 立即应用保存的主题（在组件挂载前）
const savedTheme = localStorage.getItem('ui_theme') as Theme
if (savedTheme && appStore.themes[savedTheme]) {
  appStore.applyTheme(savedTheme)
}

// 登录成功后 token 才会写入，此时再同步服务端主题；登录页不再发会 401 的请求。
watch(adminToken, (token, previous) => {
  if (token && token !== previous)
    appStore.fetchTheme()
})

// 全站背景图：登录页、控制台及所有子页面共用
watch(
  () => appStore.loginPageConfig.homeBackgroundUrl,
  (url) => {
    const root = document.documentElement
    if (!url) {
      root.style.removeProperty('--app-bg-image')
      return
    }
    const probe = new Image()
    probe.onload = () => {
      if (appStore.loginPageConfig.homeBackgroundUrl === url)
        root.style.setProperty('--app-bg-image', `url("${url}")`)
    }
    probe.onerror = () => {
      if (appStore.loginPageConfig.homeBackgroundUrl === url)
        root.style.removeProperty('--app-bg-image')
    }
    probe.src = url
  },
  { immediate: true },
)
</script>

<template>
  <div class="app-root h-screen w-screen overflow-hidden" :style="{ color: 'var(--theme-text)' }">
    <RouterView />
    <ToastContainer />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family:
    'DM Sans',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    sans-serif;
  background: var(--app-bg);
  background-image: var(--app-bg-image);
  background-size: cover;
  background-position: center;
  background-attachment: scroll;
  background-repeat: no-repeat;
  color: var(--theme-text);
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}

/* Color theme variables & Liquid Glass Design System */
:root {
  --app-bg-image: url('/bg-desktop.webp');
  --theme-bg: #f8fafc;
  --theme-text: #1e293b;
  --theme-primary: #3b82f6;
  --theme-secondary: #2563eb;
  --theme-gradient: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  --app-bg: #eff6ff;

  /* Liquid Glass Surfaces */
  --liquid-glass-bg: rgba(255, 255, 255, 0.62);
  --liquid-glass-bg-hover: rgba(255, 255, 255, 0.78);
  --liquid-glass-border: rgba(255, 255, 255, 0.75);
  --liquid-glass-border-subtle: rgba(255, 255, 255, 0.45);
  --liquid-glass-shadow: 0 12px 36px 0 rgba(15, 23, 42, 0.08), inset 0 1px 1px 0 rgba(255, 255, 255, 0.85);
  --liquid-glass-shadow-sm: 0 6px 20px 0 rgba(15, 23, 42, 0.05), inset 0 1px 1px 0 rgba(255, 255, 255, 0.75);
  --liquid-glass-blur: blur(12px) saturate(140%);

  --surface-1: rgba(255, 255, 255, 0.62);
  --surface-2: rgba(255, 255, 255, 0.75);
  --surface-3: rgba(255, 255, 255, 0.88);
  --surface-border: rgba(255, 255, 255, 0.65);
  --surface-border-strong: rgba(255, 255, 255, 0.85);
  --surface-shadow: 0 16px 45px rgba(15, 23, 42, 0.09);
  --surface-shadow-soft: 0 8px 24px rgba(15, 23, 42, 0.06);
  --muted-text: #64748b;
  --input-bg: rgba(255, 255, 255, 0.72);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 18%, transparent);
}

@media (max-width: 768px) {
  :root {
    --app-bg-image: url('/bg-mobile.webp');
  }
}

.dark {
  --liquid-glass-bg: rgba(15, 23, 42, 0.68);
  --liquid-glass-bg-hover: rgba(30, 41, 59, 0.78);
  --liquid-glass-border: rgba(255, 255, 255, 0.16);
  --liquid-glass-border-subtle: rgba(255, 255, 255, 0.09);
  --liquid-glass-shadow: 0 16px 45px 0 rgba(0, 0, 0, 0.45), inset 0 1px 1px 0 rgba(255, 255, 255, 0.18);
  --liquid-glass-shadow-sm: 0 8px 24px 0 rgba(0, 0, 0, 0.35), inset 0 1px 1px 0 rgba(255, 255, 255, 0.14);
  --liquid-glass-blur: blur(14px) saturate(140%);

  --surface-1: rgba(15, 23, 42, 0.68);
  --surface-2: rgba(30, 41, 59, 0.72);
  --surface-3: rgba(51, 65, 85, 0.75);
  --surface-border: rgba(255, 255, 255, 0.14);
  --surface-border-strong: rgba(255, 255, 255, 0.22);
  --surface-shadow: 0 18px 55px rgba(0, 0, 0, 0.45);
  --surface-shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.35);
  --muted-text: #94a3b8;
  --input-bg: rgba(15, 23, 42, 0.65);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 22%, transparent);
}

.app-root {
  background: transparent;
}

/* Liquid Glass Cards & Panels */
.ui-card {
  position: relative;
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow);
  border-radius: 18px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.ui-card:hover {
  border-color: var(--liquid-glass-border-strong, rgba(255, 255, 255, 0.9));
  box-shadow:
    0 16px 40px 0 rgba(15, 23, 42, 0.12),
    inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.95);
}

.ui-card-elevated {
  position: relative;
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow);
  border-radius: 20px;
}

.glass-panel {
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow);
  border-radius: 16px;
}

.ui-subtle-panel {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--liquid-glass-border-subtle);
  border-radius: 14px;
}

.dark .ui-subtle-panel {
  background: rgba(15, 23, 42, 0.48);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* 移动端关闭大面积背景模糊：blur 卡片叠加会显著拖慢滚动，改为接近实色的半透明底。 */
@media (max-width: 768px) {
  /* 视口固定背景在部分移动浏览器上会持续重绘，页面本身不滚动，改回 scroll 视觉不变。 */
  .app-root {
    background-attachment: scroll;
  }

  .ui-card,
  .ui-card-elevated,
  .glass-panel,
  .ui-subtle-panel {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(255, 255, 255, 0.9);
  }

  .dark .ui-card,
  .dark .ui-card-elevated,
  .dark .glass-panel,
  .dark .ui-subtle-panel {
    background: rgba(15, 23, 42, 0.92);
  }
}

/* Metric / Dashboard Card Spec */
.metric-card {
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 10% 0%, rgba(255, 255, 255, 0.35) 0%, transparent 45%),
    linear-gradient(135deg, var(--panel-glow), transparent 60%);
  border-radius: inherit;
}

.dark .metric-card::before {
  background:
    radial-gradient(circle at 10% 0%, rgba(255, 255, 255, 0.08) 0%, transparent 45%),
    linear-gradient(135deg, var(--panel-glow), transparent 60%);
}

.metric-card > * {
  position: relative;
  z-index: 1;
}

/* Liquid Glass Buttons */
.btn-primary,
button.btn-primary {
  position: relative;
  background: var(--theme-gradient) !important;
  border: 1px solid rgba(255, 255, 255, 0.4) !important;
  box-shadow:
    0 8px 24px color-mix(in srgb, var(--theme-primary) 32%, transparent),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.65) !important;
  border-radius: 12px;
  color: #ffffff !important;
  font-weight: 600;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.btn-primary:hover,
button.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow:
    0 12px 30px color-mix(in srgb, var(--theme-primary) 42%, transparent),
    inset 0 1px 2px rgba(255, 255, 255, 0.8) !important;
  filter: brightness(1.06);
}

.btn-primary:active,
button.btn-primary:active {
  transform: translateY(0) scale(0.98);
}

/* Liquid Glass Generic Button Styling */
button:not(.btn-primary):not([class*='bg-']):not([class*='text-']):not([class*='p-0']) {
  transition: all 0.2s ease;
}

.text-primary {
  color: var(--theme-primary);
}

.bg-primary {
  background-color: var(--theme-primary);
}

.border-primary {
  border-color: var(--theme-primary);
}

.bg-gradient-primary {
  background: var(--theme-gradient);
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 999px;
  backdrop-filter: blur(4px);
}

::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--theme-primary) 65%, #94a3b8);
}
</style>
