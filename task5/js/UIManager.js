/**
 * UIManager — модуль управления пользовательским интерфейсом.
 * Обрабатывает события кнопок, селекторов и индикаторов,
 * предотвращая утечку нажатий в WebXR контроллер.
 */
export class UIManager {
  constructor(modelManager, lightingManager) {
    this.modelManager = modelManager;
    this.lightingManager = lightingManager;

    this.cacheElements();
    this.bindEvents();
    this.preventXREventLeakage();
  }

  cacheElements() {
    this.uiRoot = document.getElementById('ar-ui-root');
    this.statusRow = document.getElementById('status-row');
    this.statusText = document.getElementById('status-text');
    this.hdriBadge = document.getElementById('hdri-badge');

    this.modelSelect = document.getElementById('model-select');
    this.btnScaleDown = document.getElementById('btn-scale-down');
    this.btnScaleReset = document.getElementById('btn-scale-reset');
    this.btnScaleUp = document.getElementById('btn-scale-up');

    this.btnRotLeft = document.getElementById('btn-rot-left');
    this.btnRotRight = document.getElementById('btn-rot-right');
    this.btnRotAuto = document.getElementById('btn-rot-auto');

    this.btnClear = document.getElementById('btn-clear');
    this.colorBtns = document.querySelectorAll('.color-btn');
  }

  /**
   * Предотвращение срабатывания WebXR select при нажатии на элементы UI (DOM-Overlay)
   */
  preventXREventLeakage() {
    if (this.uiRoot) {
      // Стандартный API WebXR DOM Overlay: отменяет XR select на элементах интерфейса
      this.uiRoot.addEventListener('beforexrselect', (e) => {
        e.preventDefault();
      });

      // Блокировка всплытия обычных тач-событий
      const bottomPanel = document.getElementById('bottom-panel');
      if (bottomPanel) {
        ['click', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach((eventType) => {
          bottomPanel.addEventListener(eventType, (e) => {
            e.stopPropagation();
          }, { passive: false });
        });
      }
    }
  }

  bindEvents() {
    // 1. Выбор модели
    if (this.modelSelect) {
      this.modelSelect.addEventListener('change', (e) => {
        this.modelManager.setActiveModel(e.target.value);
      });
    }

    // 2. Управление масштабом
    if (this.btnScaleDown) {
      this.btnScaleDown.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = this.modelManager.scaleDown();
        this.updateScaleDisplay(s);
      });
    }

    if (this.btnScaleReset) {
      this.btnScaleReset.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = this.modelManager.resetScale();
        this.updateScaleDisplay(s);
      });
    }

    if (this.btnScaleUp) {
      this.btnScaleUp.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = this.modelManager.scaleUp();
        this.updateScaleDisplay(s);
      });
    }

    // 3. Вращение
    if (this.btnRotLeft) {
      this.btnRotLeft.addEventListener('click', (e) => {
        e.stopPropagation();
        this.modelManager.rotate(-Math.PI / 6); // -30 градусов
      });
    }

    if (this.btnRotRight) {
      this.btnRotRight.addEventListener('click', (e) => {
        e.stopPropagation();
        this.modelManager.rotate(Math.PI / 6); // +30 градусов
      });
    }

    if (this.btnRotAuto) {
      this.btnRotAuto.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = this.modelManager.toggleAutoRotate();
        this.btnRotAuto.classList.toggle('active', isActive);
        this.btnRotAuto.textContent = isActive ? 'Авто: ВКЛ' : 'Авто: Выкл';
      });
    }

    // 4. Палитра цветов PBR
    this.colorBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.colorBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');

        const colorHex = btn.dataset.color || null;
        this.modelManager.setColor(colorHex);
      });
    });

    // 5. Кнопка очистки
    if (this.btnClear) {
      this.btnClear.addEventListener('click', (e) => {
        e.stopPropagation();
        this.modelManager.clearAll();
        this.updateObjectCount(0);
      });
    }

    // 6. Оповещение о готовности HDRI
    this.lightingManager.onHdrLoaded((success) => {
      if (this.hdriBadge) {
        if (success) {
          this.hdriBadge.classList.add('loaded');
          this.hdriBadge.textContent = 'HDRI: Студия PBR активна';
        } else {
          this.hdriBadge.textContent = 'HDRI: Локальный свет';
        }
      }
    });
  }

  updateScaleDisplay(multiplier) {
    if (this.btnScaleReset) {
      this.btnScaleReset.textContent = `${Math.round(multiplier * 100)}%`;
    }
  }

  updateHitStatus(state, message) {
    if (!this.statusRow || !this.statusText) return;

    if (state === 'detected') {
      this.statusRow.classList.add('ready');
      this.statusText.textContent = message || 'Плоскость найдена! Нажмите на экран';
    } else if (state === 'searching') {
      this.statusRow.classList.remove('ready');
      this.statusText.textContent = message || 'Поиск плоскости (наведите на пол/стол)...';
    } else {
      this.statusRow.classList.remove('ready');
      this.statusText.textContent = message || 'Ожидание запуска AR...';
    }
  }

  updateObjectCount(count) {
    if (this.btnClear) {
      this.btnClear.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (count > 0) {
      this.updateHitStatus('detected', `Объект размещен! (Всего: ${count})`);
    } else {
      this.updateHitStatus('searching', 'Поиск плоскости (наведите на пол/стол)...');
    }
  }
}
