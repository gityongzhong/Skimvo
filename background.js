// Skimvo background service worker
// 职责：把当前倍数显示到工具栏图标角标上
(() => {
  "use strict";

  // 角标最多 4 个字符：短的带 ×，长的只显示数字
  function fmtBadge(rate) {
    const s = String(Number(rate.toFixed(2)));
    return (s.length <= 3 ? s + "×" : s).slice(0, 4);
  }

  function updateBadge() {
    chrome.storage.sync.get({ enabled: true, rate: 1 }, (s) => {
      if (s.enabled) {
        chrome.action.setBadgeText({ text: fmtBadge(s.rate) });
        chrome.action.setBadgeBackgroundColor({ color: "#0a3cf5" }); // LOGO 同款蓝
        try {
          chrome.action.setBadgeTextColor({ color: "#ffffff" });
        } catch {
          // 旧版浏览器无此 API，忽略
        }
      } else {
        chrome.action.setBadgeText({ text: "⏸" });
        chrome.action.setBadgeBackgroundColor({ color: "#4a4b53" });
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.rate || changes.enabled)) updateBadge();
  });
  chrome.runtime.onInstalled.addListener(updateBadge);
  chrome.runtime.onStartup.addListener(updateBadge);
})();
