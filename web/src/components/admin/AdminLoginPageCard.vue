<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  if (type === 'danger')
    toast.error(message)
  else
    toast.success(message)
}

const {
  localLoginLinks,
  loginLinksSaving,
  loginLogoUploading,
  homeBackgroundUploading,
  showResetLoginLinksConfirm,
  loadLoginLinks,
  handleSaveLoginLinks,
  handleResetLoginLinks,
  openResetLoginLinksConfirm,
  handleUploadLoginLogo,
  handleUploadHomeBackground,
} = useAdminSystemConfig({ showAlert })

const fileInput = ref<HTMLInputElement | null>(null)
const backgroundInput = ref<HTMLInputElement | null>(null)

function pickLogoFile() {
  fileInput.value?.click()
}

function pickBackgroundFile() {
  backgroundInput.value?.click()
}

function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    handleUploadLoginLogo(file)
  input.value = ''
}

function onBackgroundChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    handleUploadHomeBackground(file)
  input.value = ''
}

onMounted(loadLoginLinks)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
          登录页自定义
        </h3>
        <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          自定义登录页品牌图标、文案与全站背景图，保存后立即生效。
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <BaseButton variant="secondary" size="sm" :disabled="loginLinksSaving || loginLogoUploading || homeBackgroundUploading" @click="openResetLoginLinksConfirm">
          恢复默认
        </BaseButton>
        <BaseButton variant="primary" size="sm" :loading="loginLinksSaving" :disabled="loginLogoUploading || homeBackgroundUploading" @click="handleSaveLoginLinks">
          <span class="i-carbon-save mr-1" />
          保存登录页设置
        </BaseButton>
      </div>
    </div>

    <section class="border border-gray-200 rounded-2xl bg-white p-4 sm:p-5 dark:border-gray-700 dark:bg-gray-800">
      <div class="mb-5 flex items-center gap-2.5 border-b border-gray-100 pb-3 dark:border-gray-700/70">
        <div class="i-carbon-text-align-justify text-lg text-gray-400" />
        <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
          品牌与文案
        </h4>
      </div>

      <div class="space-y-5">
        <div>
          <div class="mb-2 text-sm text-gray-700 font-medium dark:text-gray-300">
            登录页LOGO
          </div>
          <div class="mb-3">
            <BaseInput
              v-model="localLoginLinks.logoUrl"
              label="LOGO图片链接（也可直接填写链接）"
              type="text"
              placeholder="https://example.com/logo.png"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <div class="h-18 w-18 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-xl bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <img
                v-if="localLoginLinks.logoUrl"
                :src="localLoginLinks.logoUrl"
                alt="登录页LOGO"
                class="h-full w-full object-contain p-1.5"
              >
              <div v-else class="i-carbon-image text-2xl text-gray-300 dark:text-gray-600" />
            </div>
            <div class="flex flex-col gap-1.5">
              <BaseButton variant="secondary" size="sm" :loading="loginLogoUploading" @click="pickLogoFile">
                {{ localLoginLinks.logoUrl ? '更换图片' : '上传图片' }}
              </BaseButton>
              <span class="text-xs text-gray-400 dark:text-gray-500">
                PNG、JPG、WebP、GIF、SVG 或 ICO，最大 2MB；也可填写图片链接。
              </span>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
              class="hidden"
              @change="onLogoChange"
            >
          </div>
        </div>

        <BaseInput
          v-model="localLoginLinks.title"
          label="站点标题"
          type="text"
          placeholder="QQ农场智能助手"
        />
        <BaseInput
          v-model="localLoginLinks.loginSubtitle"
          label="登录副标题"
          type="text"
          placeholder="欢迎回来，开启智慧农耕之旅"
        />
        <BaseInput
          v-model="localLoginLinks.registerSubtitle"
          label="注册副标题"
          type="text"
          placeholder="创建账号，开启智慧农耕之旅"
        />

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BaseInput
            v-model="localLoginLinks.purchaseUrl"
            label="购买卡密链接（可选）"
            type="text"
            placeholder="https://example.com/buy"
          />
          <BaseInput
            v-model="localLoginLinks.qqGroupUrl"
            label="QQ 群链接（可选）"
            type="text"
            placeholder="https://qm.qq.com/q/..."
          />
        </div>
      </div>
    </section>

    <section class="border border-gray-200 rounded-2xl bg-white p-4 sm:p-5 dark:border-gray-700 dark:bg-gray-800">
      <div class="mb-5 flex items-center gap-2.5 border-b border-gray-100 pb-3 dark:border-gray-700/70">
        <div class="i-carbon-image-search text-lg text-gray-400" />
        <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
          全局背景图
        </h4>
      </div>

      <div class="space-y-3">
        <BaseInput
          v-model="localLoginLinks.homeBackgroundUrl"
          label="背景图片链接（也可直接填写链接）"
          type="text"
          placeholder="https://example.com/background.jpg"
        />

        <div class="flex flex-wrap items-center gap-3">
          <BaseButton variant="secondary" size="sm" :loading="homeBackgroundUploading" @click="pickBackgroundFile">
            {{ localLoginLinks.homeBackgroundUrl ? '更换背景图片' : '上传背景图片' }}
          </BaseButton>
          <span class="text-xs text-gray-400 dark:text-gray-500">
            应用于登录页及所有后台页面，建议 16:9 或更大；PNG、JPG、WebP、GIF、SVG 或 ICO，最大 8MB。
          </span>
        </div>
        <input
          ref="backgroundInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          class="hidden"
          @change="onBackgroundChange"
        >

        <p class="text-xs text-gray-400 dark:text-gray-500">
          上传或填写链接均可；留空后保存即恢复系统默认背景（「恢复默认」会同时清除图标、背景图与文案）。
        </p>

        <div
          v-if="localLoginLinks.homeBackgroundUrl"
          class="aspect-[16/9] w-full overflow-hidden border border-gray-200 rounded-xl bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40"
        >
          <img :src="localLoginLinks.homeBackgroundUrl" alt="全局背景图" class="h-full w-full object-cover">
        </div>
        <div
          v-else
          class="aspect-[16/9] w-full flex flex-col items-center justify-center gap-1 border border-gray-200 border-dashed rounded-xl bg-gray-50 text-gray-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-600"
        >
          <div class="i-carbon-image-search text-2xl" />
          <span class="text-xs">暂未设置全局背景图</span>
        </div>
      </div>
    </section>

    <ConfirmModal
      :show="showResetLoginLinksConfirm"
      title="恢复默认登录页设置"
      message="将清除自定义图标、全局背景图、标题与副标题，恢复为系统默认样式。此操作立即生效。"
      type="danger"
      :loading="loginLinksSaving"
      confirm-text="恢复默认"
      @confirm="handleResetLoginLinks"
      @cancel="showResetLoginLinksConfirm = false"
      @close="showResetLoginLinksConfirm = false"
    />
  </div>
</template>
