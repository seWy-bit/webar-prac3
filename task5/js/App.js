import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { LightingManager } from './LightingManager.js';
import { ModelManager } from './ModelManager.js';
import { UIManager } from './UIManager.js';

/**
 * App — главный класс приложения WebAR.
 * Инициализирует рендерер, камеру, WebXR сессию с hit-test и dom-overlay,
 * и связывает модули освещения, моделей и интерфейса.
 */
export class App {
  constructor() {
    this.container = document.getElementById('webgl-canvas-container');
    this.uiRoot = document.getElementById('ar-ui-root');
    this.modalNoXr = document.getElementById('modal-no-xr');

    this.hitTestSource = null;
    this.hitTestSourceRequested = false;
    this.clock = new THREE.Clock();

    this.init();
  }

  async init() {
    // 1. Проверка поддержки WebXR immersive-ar
    if ('xr' in navigator) {
      const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!isArSupported && this.modalNoXr) {
        this.modalNoXr.classList.add('show');
      }
    } else if (this.modalNoXr) {
      this.modalNoXr.classList.add('show');
    }

    // 2. Инициализация сцены и камеры
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

    // 3. WebGL Рендерер с поддержкой WebXR и прозрачности для AR-фона
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.xr.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // 4. Подключение модулей
    this.lightingManager = new LightingManager(this.scene, this.renderer);
    this.modelManager = new ModelManager(this.scene);
    this.uiManager = new UIManager(this.modelManager, this.lightingManager);

    // 5. Кнопка запуска AR
    this.initARButton();

    // 6. Создание аккуратного компактного прицела (Reticle)
    this.initReticle();

    // 7. Контроллер взаимодействия (обработка тапа по экрану)
    this.initController();

    // 8. Обработчик изменения размеров экрана
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // 9. Старт анимационного цикла
    this.renderer.setAnimationLoop(this.render.bind(this));
  }

  initARButton() {
    const arButton = ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: this.uiRoot }
    });

    arButton.style.bottom = '16px';
    arButton.style.padding = '12px 28px';
    arButton.style.background = '#2563eb';
    arButton.style.borderRadius = '24px';
    arButton.style.border = '1px solid #3b82f6';
    arButton.style.color = '#fff';
    arButton.style.fontSize = '14px';
    arButton.style.fontWeight = '600';
    arButton.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.4)';
    arButton.style.zIndex = '200';
    document.body.appendChild(arButton);
  }

  initReticle() {
    // Компактное аккуратное кольцо (диаметр ~19 см, толщина 1.5 см)
    const ringGeo = new THREE.RingGeometry(0.08, 0.095, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981, // Мягкий изумрудно-зеленый
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.reticle = new THREE.Mesh(ringGeo, ringMat);

    // Внутренняя маркерная точка (диаметр 3 см)
    const dotGeo = new THREE.CircleGeometry(0.015, 24).rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      side: THREE.DoubleSide
    });
    const centerDot = new THREE.Mesh(dotGeo, dotMat);
    this.reticle.add(centerDot);

    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.reticle.renderOrder = 999;
    this.scene.add(this.reticle);
  }

  initController() {
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', this.onSelect.bind(this));
    this.scene.add(this.controller);
  }

  onSelect() {
    if (this.reticle.visible) {
      const placed = this.modelManager.placeAtPose(this.reticle.matrix);
      if (placed) {
        this.uiManager.updateObjectCount(this.modelManager.placedObjects.length);
      }
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const delta = this.clock.getDelta();

    // Обновление вращения моделей
    this.modelManager.update(delta);

    if (frame) {
      const session = this.renderer.xr.getSession();
      const referenceSpace = this.renderer.xr.getReferenceSpace();

      // Запрос источника Hit-Test из пространства камеры (viewer)
      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((viewerSpace) => {
          session.requestHitTestSource({ space: viewerSpace }).then((source) => {
            this.hitTestSource = source;
            this.uiManager.updateHitStatus('searching', 'Поиск плоскости (наведите на пол/стол)...');
          });
        });

        session.addEventListener('end', () => {
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
          this.reticle.visible = false;
          this.uiManager.updateHitStatus('idle', 'AR сессия завершена');
        });

        this.hitTestSourceRequested = true;
      }

      // Обновление позиции прицела при наличии источника Hit-Test и опорного пространства
      if (this.hitTestSource && referenceSpace) {
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);

          if (pose) {
            this.reticle.visible = true;
            this.reticle.matrix.fromArray(pose.transform.matrix);
            this.uiManager.updateHitStatus('detected', 'Плоскость найдена! Нажмите на экран для размещения');
          }
        } else {
          this.reticle.visible = false;
          this.uiManager.updateHitStatus('searching', 'Поиск плоскости (наведите на пол/стол)...');
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Запуск приложения при загрузке DOM
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
