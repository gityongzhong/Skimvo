const MIN_RATE = 0.07;
const MAX_RATE = 16;

const $ = (id) => document.getElementById(id);
const rateSlider = $("rate");
const rateBox = $("rateBox");
const enabledToggle = $("enabled");

function fmtNum(rate) {
  return String(Number(rate.toFixed(2)));
}

function clampRate(rate) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
}

function paintSlider(rate) {
  const pct = ((rate - 0.25) / (16 - 0.25)) * 100;
  rateSlider.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, #4a4b53 ${pct}%, #4a4b53 100%)`;
}

function setRate(rate) {
  rate = clampRate(rate);
  rateBox.value = fmtNum(rate);
  rateSlider.value = rate;
  paintSlider(rate);
  chrome.storage.sync.set({ rate });
}

// 滑块
rateSlider.addEventListener("input", () => setRate(Number(rateSlider.value)));

// 预设按钮
document.querySelectorAll(".presets button").forEach((btn) =>
  btn.addEventListener("click", () => setRate(Number(btn.dataset.rate)))
);

// 手动输入：回车或失焦生效，非法值回退
rateBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") rateBox.blur();
});

rateBox.addEventListener("blur", () => {
  const raw = normalizeInput(rateBox.value).replace(/[×xX\s]/g, "");
  const v = parseFloat(raw);
  if (isNaN(v) || v <= 0) {
    rateBox.value = fmtNum(clampRate(Number(rateSlider.value) || 1));
    return;
  }
  setRate(v);
});

// 输入框获得焦点时全选，方便直接覆盖
rateBox.addEventListener("focus", () => rateBox.select());

// 全角数字/中文标点 → 半角，兼容中文输入法
function normalizeInput(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0xff10 && c <= 0xff19) out += String.fromCharCode(c - 0xfee0);
    else if (ch === "，" || ch === "。" || ch === "．" || ch === ",") out += ".";
    else out += ch;
  }
  return out;
}

enabledToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

chrome.storage.sync.get({ enabled: true, rate: 1 }, (s) => {
  enabledToggle.checked = s.enabled;
  setRate(s.rate);
});

// 显示当前加载的扩展版本，方便确认浏览器里跑的是不是最新代码
$("ver").textContent = "Skimvo v" + chrome.runtime.getManifest().version;
