import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/**
 * LightingManager — модуль управления освещением сцены и HDRI-картами.
 * Отвечает за прямое освещение (Directional, Hemisphere) и PBR-окружение (Environment Map).
 */
export class LightingManager {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hdrLoaded = false;
    this.onHdrLoadCallback = null;

    this.initLights();
    this.initHDRI();
  }

  initLights() {
    // Полусферический рассеянный свет (небо и земля) для мягких теней
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 2.0);
    this.hemiLight.position.set(0.5, 5, 0.25);
    this.scene.add(this.hemiLight);

    // Основной направленный источник света (солнце)
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.dirLight.position.set(2, 6, 3);
    this.scene.add(this.dirLight);

    // Контровой свет для подчеркивания контуров моделей в AR
    this.fillLight = new THREE.DirectionalLight(0x00d2ff, 0.8);
    this.fillLight.position.set(-2, 2, -2);
    this.scene.add(this.fillLight);
  }

  initHDRI() {
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load(
      './assets/studio_small_08_1k.hdr',
      (texture) => {
        // Назначаем проекцию карты окружения для отражений PBR
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.environment = texture;

        this.hdrLoaded = true;
        console.log('[LightingManager] HDRI карта studio_small_08_1k.hdr успешно подключена');

        if (this.onHdrLoadCallback) {
          this.onHdrLoadCallback(true);
        }
      },
      undefined,
      (err) => {
        console.warn('[LightingManager] Ошибка загрузки HDRI:', err);
        if (this.onHdrLoadCallback) {
          this.onHdrLoadCallback(false);
        }
      }
    );
  }

  onHdrLoaded(callback) {
    this.onHdrLoadCallback = callback;
    if (this.hdrLoaded && callback) {
      callback(true);
    }
  }
}
