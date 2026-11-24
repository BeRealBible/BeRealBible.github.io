/* Immersive shell only. Reading gestures belong to sticker-reader.js. */
(() => {
  'use strict';
  const root = document.documentElement;
  const v25 = root.dataset.readerBuild === 'index-25';
  let scene = 'reading';
  let chromeVisible = false;
  let initialized = false;
  let hideTimer = 0;
  let keyboardMode = false;
  let heldControls = 0;
  let hoveredControls = 0;
  let edgeRevealed = false;
  let shelfPointer = false;
  let deferredInstall = null;
  let groups = [];
  let dock, menuButton, fullscreenButton, fullscreenNotice, installButton, installDialog, installStatus;
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;
  const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const canFullscreen = () => Boolean(
    (root.requestFullscreen && document.fullscreenEnabled !== false) ||
    (root.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false)
  );

  function scheduleHide(delay = edgeRevealed ? 420 : 5000) {
    window.clearTimeout(hideTimer);
    if (!chromeVisible || scene !== 'reading' || (edgeRevealed && shelfPointer)) return;
    hideTimer = window.setTimeout(() => {
      const focused = keyboardMode && groups.some(group => group.contains(document.activeElement));
      if (heldControls || hoveredControls || focused || document.querySelector('dialog[open]')) {
        scheduleHide(1000);
      } else hideChrome();
    }, delay);
  }

  function setControlsVisible(visible) {
    groups.forEach(group => {
      group.inert = !visible;
      group.setAttribute('aria-hidden', String(!visible));
    });
    root.dataset.readerChrome = visible ? 'visible' : 'hidden';
    if (v25 && !visible) window.dispatchEvent(new Event('paper-reader-chrome-hidden'));
    if (menuButton) {
      menuButton.setAttribute('aria-expanded', String(visible));
      menuButton.setAttribute('aria-label', visible ? '收起阅读工具' : '展开阅读工具');
    }
  }

  function showChrome(fromEdge = false) {
    if (scene !== 'reading' || (!v25 && document.body?.hasAttribute('data-minimal-reader'))) return;
    edgeRevealed = fromEdge === true;
    chromeVisible = true;
    setControlsVisible(true);
    scheduleHide();
  }

  function hideChrome() {
    window.clearTimeout(hideTimer);
    if (keyboardMode && groups.some(group => group.contains(document.activeElement))) {
      (v25 ? document.getElementById('stage') : menuButton)?.focus({ preventScroll: true });
    }
    chromeVisible = false;
    edgeRevealed = false;
    shelfPointer = false;
    heldControls = 0;
    hoveredControls = 0;
    setControlsVisible(false);
  }

  function setScene(nextScene) {
    if (nextScene !== 'reading' && nextScene !== 'directory') return;
    scene = nextScene;
    root.dataset.readerScene = scene;
    root.dataset.paperScene = scene;
    if (document.body) document.body.dataset.paperScene = scene;
    hideChrome();
    if (dock) {
      dock.inert = scene !== 'reading';
      dock.setAttribute('aria-hidden', String(scene !== 'reading'));
    }
    if (scene === 'directory' && installDialog?.open) installDialog.close();
  }

  function bindFullscreen(button, notice) {
    fullscreenButton = button;
    fullscreenNotice = notice;
    button.addEventListener('click', toggleFullscreen);
    syncFullscreen();
  }

  function showAtReadingBoundary() {
    const stage = document.getElementById('stage');
    if (!v25 || root.dataset.ruleLayout !== 'ready' || stage?.dataset.v25Opening ||
        document.querySelector('dialog[open],.edge-chapters:not([hidden])')) return;
    showChrome();
  }

  window.PaperImmersion = Object.freeze({ setScene, showChrome, hideChrome, bindFullscreen, showAtReadingBoundary });

  function syncFullscreen() {
    if (!fullscreenButton) return;
    const active = isFullscreen(), label = active ? '退出全屏' : '全屏阅读';
    if (fullscreenNotice) {
      fullscreenButton.setAttribute('aria-label', label);
      fullscreenButton.title = label;
    } else {
      fullscreenButton.hidden = !canFullscreen() && !active;
      fullscreenButton.textContent = label;
    }
    fullscreenButton.setAttribute('aria-pressed', String(active));
  }

  function syncInstall() {
    if (!installButton) return;
    installButton.textContent = isStandalone() ? '主屏幕模式' : '添加到主屏幕';
    const promptButton = document.getElementById('immersion-install-now');
    promptButton.hidden = !deferredInstall || isStandalone();
    installStatus.textContent = isStandalone()
      ? '你正在主屏幕独立窗口中阅读。系统状态栏和手势区域仍由设备管理。'
      : '普通网页不能强制隐藏浏览器地址栏。支持全屏时可用「全屏阅读」；从主屏幕打开，通常更接近一本没有工具栏的书。';
  }

  function openInstallGuide(message) {
    syncInstall();
    if (message) installStatus.textContent = message;
    window.dispatchEvent(new CustomEvent('paper-interrupt'));
    installDialog.showModal();
  }

  async function toggleFullscreen() {
    // This function is invoked only by the explicit button click, not on startup/tap/rotation.
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } else if (canFullscreen()) {
        if (root.requestFullscreen && document.fullscreenEnabled !== false) await root.requestFullscreen({ navigationUI: 'hide' });
        else await root.webkitRequestFullscreen();
        hideChrome();
      } else if (fullscreenNotice) fullscreenNotice('当前浏览器不支持网页全屏，可继续正常阅读。');
      else openInstallGuide();
    } catch (_) {
      if (fullscreenNotice) fullscreenNotice('浏览器未允许切换全屏，可继续正常阅读。');
      else openInstallGuide('这次未能进入全屏；浏览器可能不支持或限制了它。你仍可通过浏览器菜单添加到主屏幕，不影响继续读经。');
    }
    syncFullscreen();
  }

  function protectControlInteraction(group) {
    group.addEventListener('pointerdown', () => {
      keyboardMode = false;
      heldControls += 1;
      scheduleHide();
    });
    const released = () => { heldControls = Math.max(0, heldControls - 1); scheduleHide(); };
    group.addEventListener('pointerup', released);
    group.addEventListener('pointercancel', released);
    group.addEventListener('lostpointercapture', released);
    group.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse') { hoveredControls += 1; scheduleHide(); }
    });
    group.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse') hoveredControls = Math.max(0, hoveredControls - 1);
      heldControls = 0;
      scheduleHide();
    });
    group.addEventListener('focusin', () => scheduleHide());
    group.addEventListener('focusout', () => scheduleHide());
    group.addEventListener('input', () => scheduleHide());
    group.addEventListener('click', () => scheduleHide());
  }

  function watchBottomEdge(shelf, stage) {
    if (!shelf || !stage) return;
    const wideMouse = window.matchMedia('(min-width: 800px) and (any-hover: hover) and (any-pointer: fine)');
    const grip = 8;
    let atBottom = false;
    window.addEventListener('pointermove', event => {
      if (!wideMouse.matches || event.pointerType !== 'mouse') return;
      const { clientX: x, clientY: y, buttons, target } = event;
      const inStrip = x >= 0 && x < window.innerWidth && y >= window.innerHeight - grip && y < window.innerHeight;
      const entered = inStrip && !atBottom;
      atBottom = inStrip;
      const overShelf = target?.closest?.('#reading-history') === shelf;
      if (edgeRevealed) {
        const inside = inStrip || overShelf;
        if (inside !== shelfPointer) { shelfPointer = inside; scheduleHide(); }
        return;
      }
      // Hover only: the reader itself decides whether a scroll reached a limit.
      if (!entered || buttons || chromeVisible || scene !== 'reading' || root.dataset.ruleLayout !== 'ready') return;
      if (stage.dataset.v25Opening || /^(dragging|automatic|settling)/.test(stage.dataset.foldState || '') ||
          /^(running|switching)$/.test(stage.dataset.jumpState || '') ||
          document.querySelector('dialog[open],.edge-chapters:not([hidden])') ||
          target?.closest?.('.compare-slip,#verse-finder,#v25-citation-choice,.paper-selection-tools')) return;
      shelfPointer = true;
      showChrome(true);
    }, { capture: true, passive: true });
    window.addEventListener('pointerout', event => {
      if (event.pointerType !== 'mouse' || event.relatedTarget) return;
      atBottom = false;
      if (edgeRevealed) { shelfPointer = false; hoveredControls = 0; scheduleHide(); }
    }, true);
    const reset = () => {
      atBottom = false;
      if (edgeRevealed) hideChrome();
    };
    window.addEventListener('blur', reset);
    wideMouse.addEventListener?.('change', reset);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    if (document.body.hasAttribute('data-minimal-reader')) {
      groups = [document.querySelector('.reader-header'), document.getElementById('reading-tools'), document.querySelector('.reader-footer'), v25 && document.getElementById('reading-history')].filter(Boolean);
      groups.forEach(protectControlInteraction);
      if (v25) watchBottomEdge(document.getElementById('reading-history'), document.getElementById('stage'));
      root.classList.add('paper-immersive');
      setScene(scene);
      window.dispatchEvent(new Event('resize'));
      return;
    }
    document.body.insertAdjacentHTML('beforeend', `
      <div class="immersion-dock" id="immersion-dock" role="group" aria-label="阅读入口">
        <button id="immersion-menu" class="immersion-quiet-button" aria-label="展开阅读工具" aria-expanded="false" aria-controls="reading-tools immersion-extra reading-history">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg><span class="immersion-sr-only">阅读工具</span>
        </button>
      </div>
      <div id="immersion-extra" class="immersion-extra" role="group" aria-label="沉浸阅读设置">
        <button id="immersion-directory" type="button" aria-label="选择书卷与章节">书卷章节</button>
        <button id="immersion-fullscreen" type="button" aria-pressed="false">全屏阅读</button>
        <button id="immersion-install" type="button">添加到主屏幕</button>
        <button id="immersion-about" type="button">关于</button>
      </div>
      <dialog id="immersion-install-dialog" class="immersion-install-dialog" aria-labelledby="immersion-install-title">
        <button class="dialog-close" id="immersion-install-close" aria-label="关闭主屏幕说明">×</button>
        <div class="eyebrow">把书放到主屏幕</div>
        <h2 id="immersion-install-title">留下书页，<br>收起浏览器。</h2>
        <p id="immersion-install-status"></p>
        <ol class="immersion-install-steps">
          <li><strong>iPhone / iPad</strong><span>用 Safari 打开 → 分享菜单 →「添加到主屏幕」。如果有「作为网页 App 打开」，请开启，再点「添加」。</span></li>
          <li><strong>Android</strong><span>打开浏览器菜单 →「添加到主屏幕」或「安装应用」。具体名称和可用性取决于浏览器。</span></li>
        </ol>
        <button id="immersion-install-now" class="immersion-install-now" type="button" hidden>安装纸页</button>
        <p class="immersion-install-note">之后从主屏幕图标进入。此体验版不提供离线缓存；首次打开或更新时仍需要网络。</p>
      </dialog>`);
    dock = document.getElementById('immersion-dock');
    menuButton = document.getElementById('immersion-menu');
    fullscreenButton = document.getElementById('immersion-fullscreen');
    installButton = document.getElementById('immersion-install');
    installDialog = document.getElementById('immersion-install-dialog');
    installStatus = document.getElementById('immersion-install-status');
    groups = [document.querySelector('.reader-header'), document.getElementById('reading-tools'),
      document.querySelector('.reader-footer'), document.getElementById('immersion-extra'),
      v25 && document.getElementById('reading-history'), v25 && dock].filter(Boolean);
    groups.forEach(protectControlInteraction);
    menuButton.addEventListener('click', () => chromeVisible ? hideChrome() : showChrome());
    document.getElementById('immersion-directory').addEventListener('click', () => {
      hideChrome();
      window.dispatchEvent(new CustomEvent('paper-directory-request'));
    });
    bindFullscreen(fullscreenButton);
    installButton.addEventListener('click', () => openInstallGuide());
    document.getElementById('immersion-install-close').addEventListener('click', () => installDialog.close());
    installDialog.addEventListener('close', () => scheduleHide());
    document.getElementById('immersion-about').addEventListener('click', () => {
      document.getElementById('about-open')?.click();
    });
    document.getElementById('immersion-install-now').addEventListener('click', async () => {
      if (!deferredInstall) return;
      const prompt = deferredInstall;
      deferredInstall = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        installStatus.textContent = choice.outcome === 'accepted'
          ? '已提交安装。完成后，从主屏幕图标打开纸页。'
          : '未安装。你可以继续在这里读经，稍后再从浏览器菜单添加。';
      } catch (_) {
        installStatus.textContent = '当前无法调起安装窗口，请使用下方的浏览器菜单方式。';
      }
      document.getElementById('immersion-install-now').hidden = true;
    });
    root.classList.add('paper-immersive');
    setScene(scene);
    syncFullscreen();
    syncInstall();
    // Layout now fills the viewport. Notify the existing fit/pan calculation, without changing it here.
    window.dispatchEvent(new Event('resize'));
  }

  window.addEventListener('paper-reader-tap', () => chromeVisible ? hideChrome() : showChrome());
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') keyboardMode = true;
    if (v25 && event.key === 'Enter' && event.target === document.getElementById('stage')) {
      event.preventDefault();
      keyboardMode = true;
      if (chromeVisible) hideChrome();
      else { showChrome(); (menuButton || document.querySelector('#reading-history button'))?.focus({ preventScroll: true }); }
    }
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) hideChrome();
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstall = event;
    if (initialized) syncInstall();
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; if (initialized) syncInstall(); });
  standaloneQuery.addEventListener?.('change', () => { if (initialized) syncInstall(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
