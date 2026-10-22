<script setup lang="ts">
import { onMounted } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useSupportContact } from '@/composables/useSupportContact'

const toast = useToastStore()
const {
  config,
  show,
  previewQrcode,
  title,
  subtitle,
  qrcodeHint,
  qqTitle,
  wechatTitle,
  groupTitle,
  safeGroupLink,
  safeQrcodeUrl,
  qqChatLink,
  visible,
  load,
  close,
} = useSupportContact()

async function copyText(text: string, label: string) {
  if (!text)
    return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    }
    else {
      // 非安全上下文（http 局域网访问）下 clipboard API 不可用，退回 execCommand
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    toast.success(`${label}已复制`)
  }
  catch {
    toast.error('复制失败，请手动选择复制')
  }
}

onMounted(load)
</script>

<template>
  <Teleport to="body">
    <Transition name="support-fade">
      <div
        v-if="visible && show"
        class="support-mask"
        @click="close"
      >
        <div class="support-dialog" @click.stop>
          <div class="mb-4 flex items-start justify-between gap-3">
            <div class="min-w-0 flex items-start gap-3">
              <div class="mt-0.5 h-9 w-9 flex shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                <div class="i-carbon-headset text-lg" />
              </div>
              <div class="min-w-0">
                <h3 class="support-dialog-title">
                  {{ title }}
                </h3>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {{ subtitle }}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 border-none bg-transparent p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="关闭"
              @click="close"
            >
              <div class="i-carbon-close text-lg" />
            </button>
          </div>

          <div class="space-y-2">
            <!-- QQ：左侧复制，右侧点开对话 -->
            <div v-if="config?.qq" class="support-row support-row-split">
              <button
                type="button"
                class="support-row-main"
                @click="copyText(config.qq, qqTitle)"
              >
                <span class="i-carbon-chat shrink-0 text-lg text-blue-500" />
                <span class="support-row-label">{{ qqTitle }}</span>
                <span class="support-row-value">{{ config.qq }}</span>
                <span class="i-carbon-copy shrink-0 text-base text-gray-400" />
              </button>
              <a
                v-if="qqChatLink"
                :href="qqChatLink"
                target="_blank"
                rel="noopener noreferrer"
                class="support-jump-btn"
                title="打开 QQ 对话"
                aria-label="打开 QQ 对话"
              >
                <span class="support-jump-text">点击打开</span>
                <span class="i-carbon-arrow-up-right shrink-0 text-base text-gray-400" />
              </a>
            </div>

            <button
              v-if="config?.wechat"
              type="button"
              class="support-row"
              @click="copyText(config.wechat, wechatTitle)"
            >
              <span class="i-carbon-logo-wechat shrink-0 text-lg text-green-500" />
              <span class="support-row-label">{{ wechatTitle }}</span>
              <span class="support-row-value">{{ config.wechat }}</span>
              <span class="i-carbon-copy shrink-0 text-base text-gray-400" />
            </button>

            <!-- 群号与加群链接合并为一行：有群号可复制，有链接可跳转 -->
            <div v-if="config?.group || safeGroupLink" class="support-row support-row-split">
              <button
                v-if="config?.group"
                type="button"
                class="support-row-main"
                @click="copyText(config.group, groupTitle)"
              >
                <span class="i-carbon-user-multiple shrink-0 text-lg text-violet-500" />
                <span class="support-row-label">{{ groupTitle }}</span>
                <span class="support-row-value">{{ config.group }}</span>
                <span class="i-carbon-copy shrink-0 text-base text-gray-400" />
              </button>
              <span v-else class="support-row-main support-row-static">
                <span class="i-carbon-user-multiple shrink-0 text-lg text-violet-500" />
                <span class="support-row-label">{{ groupTitle }}</span>
              </span>
              <a
                v-if="safeGroupLink"
                :href="safeGroupLink"
                target="_blank"
                rel="noopener noreferrer"
                class="support-jump-btn"
                title="打开加群链接"
                aria-label="打开加群链接"
              >
                <span class="support-jump-text">点击打开</span>
                <span class="i-carbon-arrow-up-right shrink-0 text-base text-gray-400" />
              </a>
            </div>
          </div>

          <div v-if="safeQrcodeUrl" class="mt-4 text-center">
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {{ qrcodeHint }}
            </p>
            <img
              :src="safeQrcodeUrl"
              alt="微信客服二维码"
              class="support-qrcode"
              title="点击放大"
              @click="previewQrcode = true"
            >
          </div>

          <div class="mt-6 flex justify-end">
            <button type="button" class="support-close-btn" @click="close">
              关闭
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 二维码放大预览 -->
    <Transition name="support-fade">
      <div
        v-if="previewQrcode && safeQrcodeUrl"
        class="support-qr-preview"
        @click="previewQrcode = false"
      >
        <img :src="safeQrcodeUrl" alt="微信客服二维码" class="max-h-[80vh] max-w-full object-contain">
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.support-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
}

.support-qr-preview {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.8);
}

.support-dialog {
  width: 100%;
  max-width: 28rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  background-color: #fff;
  padding: 1.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

.dark .support-dialog {
  border-color: #374151;
  background-color: #1f2937;
}

.support-dialog-title {
  font-size: 1rem;
  line-height: 1.5rem;
  font-weight: 600;
  color: #111827;
}

.dark .support-dialog-title {
  color: #fff;
}

.support-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: rgba(238, 243, 248, 0.8);
  cursor: pointer;
  text-align: left;
}

.dark .support-row {
  border-color: #374151;
  background: rgba(31, 41, 55, 0.7);
}

/* 普通行整行可点；QQ/群号行拆成「复制区 + 跳转区」，内边距交给子元素 */
.support-row:not(.support-row-split) {
  padding: 10px 12px;
}

.support-row-split {
  gap: 0;
  overflow: hidden;
  padding: 0;
  cursor: default;
}

.support-row-main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

/* 只有链接、没有群号时这一侧不可点，仅作标题展示 */
.support-row-static {
  cursor: default;
}

.support-jump-btn {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  gap: 4px;
  padding: 0 12px;
  border-left: 1px solid #e5e7eb;
  color: #2563eb;
}

.dark .support-jump-btn {
  border-left-color: #374151;
  color: #60a5fa;
}

.support-jump-text {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.support-jump-btn:hover {
  background: rgba(37, 99, 235, 0.1);
  border-radius: 0 10px 10px 0;
}

.support-row:hover {
  border-color: rgba(37, 99, 235, 0.4);
}

.support-row-label {
  flex: none;
  color: #6b7280;
  font-size: 13px;
}

.dark .support-row-label {
  color: #9ca3af;
}

.support-row-value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dark .support-row-value {
  color: #f3f4f6;
}

.support-qrcode {
  display: inline-block;
  max-height: 200px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  object-fit: contain;
  cursor: zoom-in;
}

.dark .support-qrcode {
  border-color: #374151;
}

.support-close-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 10px;
  background: #2563eb;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.support-close-btn:hover {
  background: #1d4ed8;
}

.support-fade-enter-active,
.support-fade-leave-active {
  transition: opacity 0.15s ease;
}

.support-fade-enter-from,
.support-fade-leave-to {
  opacity: 0;
}
</style>
