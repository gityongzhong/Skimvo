// Skimvo content script
// 职责：接管页面内所有 video/audio 的 playbackRate，跟随全局设置；
//       对抗网页自行重置速度；用户手动调速后给宽限期。
(() => {
  "use strict";

  const MANUAL_GRACE_MS = 10000; // 用户手动调速后 10 秒内不干预
  const GESTURE_WINDOW_MS = 1000; // 调速动作发生在用户操作后 1 秒内视为手动
  const EPSILON = 0.001;

  const state = { enabled: true, rate: 1 };
  let graceUntil = 0;
  let lastGesture = 0;
  let applying = false; // 标记「由本扩展设置」，避免 ratechange 自触发
  const mutedByUs = new WeakSet(); // 记录由本扩展静音的元素，降速后恢复
  const MUTE_ABOVE = 4; // 超过 4× 声音已是噪音，自动静音

  // 记录最近一次可信用户操作时间（点击/按键/滚轮）
  ["pointerdown", "keydown", "wheel"].forEach((ev) =>
    document.addEventListener(ev, () => {
      lastGesture = Date.now();
    }, true)
  );

  function targetRate() {
    return state.enabled ? state.rate : 1;
  }

  function isMedia(t) {
    return t instanceof HTMLMediaElement;
  }

  function applyTo(el) {
    // 浏览器合法区间 [0.0625, 16]，越界部分个别实现会抛错，先钳制
    const target = Math.min(16, Math.max(0.0625, targetRate()));
    if (Math.abs(el.playbackRate - target) < EPSILON) return;
    if (Date.now() < graceUntil) return;
    applying = true;
    try {
      el.playbackRate = target;
      // 高倍率自动静音（刷画面场景），降回 4× 内恢复
      if (target > MUTE_ABOVE && !el.muted) {
        el.muted = true;
        mutedByUs.add(el);
      } else if (target <= MUTE_ABOVE && mutedByUs.has(el)) {
        el.muted = false;
        mutedByUs.delete(el);
      }
    } catch {
      // 个别 DRM/受保护媒体可能抛错，忽略即可
    } finally {
      applying = false;
    }
  }

  function applyAll() {
    document.querySelectorAll("video, audio").forEach(applyTo);
  }

  // 网页试图改速度（非用户操作）→ 纠正回目标速度
  document.addEventListener(
    "ratechange",
    (e) => {
      const el = e.target;
      if (!isMedia(el) || applying) return;
      const now = Date.now();
      if (now - lastGesture < GESTURE_WINDOW_MS) {
        // 视为用户在播放器里手动调速，给宽限期
        graceUntil = now + MANUAL_GRACE_MS;
        return;
      }
      applyTo(el);
    },
    true
  );

  // 媒体开始播放/元数据加载完成时应用速度
  ["play", "playing", "loadedmetadata", "durationchange"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (isMedia(e.target)) applyTo(e.target);
    }, true)
  );

  // 设置变化 → 实时生效
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.enabled) state.enabled = changes.enabled.newValue;
    if (changes.rate) state.rate = changes.rate.newValue;
    graceUntil = 0;
    applyAll();
  });

  // 初始化
  chrome.storage.sync.get({ enabled: true, rate: 1 }, (s) => {
    state.enabled = s.enabled;
    state.rate = s.rate;
    applyAll();
  });

  // 兜底：每秒检查一次所有媒体元素
  // 覆盖两种死角：宽限期结束后页面不再触发事件、脚本注入晚于媒体创建
  setInterval(applyAll, 1000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAll);
  } else {
    applyAll();
  }
})();
