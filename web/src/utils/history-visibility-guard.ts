/**
 * Chromium 内核（Edge / 部分 Chrome 版本）的“最小化后窗口立刻弹回”问题规避。
 *
 * 复现链路：窗口最小化 → document.visibilityState 变为 hidden → 触发 visibilitychange →
 * vue-router 的 beforeUnload 监听在该事件里调用 history.replaceState 保存滚动状态 →
 * 内核把“可见性派发期间的 history 写入”误判成页面激活 → 已最小化的窗口被强制还原。
 *
 * 处理方式：只在 visibilitychange / pagehide 的事件派发期间丢弃 history.replaceState，
 * 派发结束后立即恢复。真正由用户操作触发的路由跳转（pushState / replaceState）不受影响，
 * 因为它们在事件派发之外执行。
 *
 * 说明：这里只拦截 replaceState，因为最小化弹回由 vue-router 在可见性事件里的滚动状态写入
 * 触发；pushState 只在真实导航时使用，保留原行为避免 URL 与视图不同步。
 */

let suspendHistoryWrite = false

function beginHistoryWriteSuspend() {
  suspendHistoryWrite = true
  // 事件派发是同步完成的：宏任务在本次派发（含其它监听器与微任务）结束后复位。
  window.setTimeout(() => {
    suspendHistoryWrite = false
  }, 0)
}

document.addEventListener('visibilitychange', beginHistoryWriteSuspend, true)
window.addEventListener('pagehide', beginHistoryWriteSuspend, true)

// 兜底：极端情况下后台定时器被节流，页面重新可见时立即恢复写入。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible')
    suspendHistoryWrite = false
}, true)

const originalReplaceState = window.history.replaceState.bind(window.history)

window.history.replaceState = function patchedReplaceState(
  data: any,
  unused: string,
  url?: string | URL | null,
) {
  if (suspendHistoryWrite)
    return
  originalReplaceState(data, unused, url)
} as History['replaceState']

export {}
