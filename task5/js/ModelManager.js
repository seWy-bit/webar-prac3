import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * ModelManager — модуль управления 3D-моделями с прямым фиксированным масштабированием.
 * Без сложных алгоритмов распознавания габаритов — прямой проверенный масштаб в метрах.
 */
export class ModelManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();

    // Загруженные шаблоны моделей с прямыми фиксированными коэффициентами
    this.models = {
      drone: {
        name: 'DJI FPV Дрон',
        url: './assets/drone.glb?v=3',
        baseScale: 0.10, // Прямой масштаб: размах ~73 см (в 150 раз больше прежнего!)
        offsetX: -0.07,  // Точная центровка
        offsetY: 0.20,   // Шасси стоят точно на плоскости пола
        pivot: null
      },
      mask: {
        name: 'Японская маска',
        url: './assets/mask.glb?v=3',
        baseScale: 0.35, // Фиксированный масштаб ~70 см
        offsetX: 0,
        offsetY: 0.35,
        pivot: null
      }
    };

    this.activeModelKey = 'drone';
    this.placedObjects = [];
    this.scaleMultiplier = 1.0;
    this.currentColor = null;
    this.autoRotateEnabled = false;

    this.initPreload();
  }

  /**
   * Предзагрузка моделей с прямой установкой смещения
   */
  initPreload() {
    Object.keys(this.models).forEach((key) => {
      const item = this.models[key];

      this.loader.load(
        item.url,
        (gltf) => {
          const root = gltf.scene;

          // Прямое позиционирование модели
          root.position.x = item.offsetX;
          root.position.y = item.offsetY;
          root.position.z = 0;

          // Сохраняем исходные PBR-цвета материалов
          root.traverse((child) => {
            if (child.isMesh && child.material) {
              child.castShadow = true;
              child.receiveShadow = true;

              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m) => {
                if (!m.userData.originalColor) {
                  m.userData.originalColor = m.color.clone();
                }
              });
            }
          });

          // Оборачиваем в контейнер-опору (pivot)
          const pivot = new THREE.Group();
          pivot.add(root);
          item.pivot = pivot;

          console.log(`[ModelManager] ${item.name} готова. Фиксированный масштаб: ${item.baseScale}`);
        },
        undefined,
        (err) => console.error(`[ModelManager] Ошибка загрузки ${item.url}:`, err)
      );
    });
  }

  /**
   * Размещение объекта на поверхности по матрице прицела Hit-Test
   */
  placeAtPose(matrix) {
    const item = this.models[this.activeModelKey];
    if (!item.pivot) {
      console.warn('[ModelManager] Модель еще загружается...');
      return null;
    }

    const group = new THREE.Group();
    const clone = item.pivot.clone(true);
    group.add(clone);

    // Извлекаем позицию и ориентацию из матрицы найденной плоскости
    const dummyScale = new THREE.Vector3();
    matrix.decompose(group.position, group.quaternion, dummyScale);

    // Прямой выверенный масштаб без вычислений
    const s = item.baseScale * this.scaleMultiplier;
    group.scale.set(s, s, s);
    group.userData.modelKey = this.activeModelKey;

    // Применяем выбранный PBR-цвет, если задан
    if (this.currentColor) {
      this.applyColorToGroup(group, this.currentColor);
    }

    this.scene.add(group);
    this.placedObjects.push(group);

    console.log(`[ModelManager] Объект ${item.name} размещен со scale: ${s}`);
    return group;
  }

  /**
   * Переключение активной модели
   */
  setActiveModel(key) {
    if (!this.models[key]) return;
    this.activeModelKey = key;

    this.placedObjects.forEach((group) => {
      this.replaceModelInGroup(group, key);
    });
  }

  replaceModelInGroup(group, key) {
    const item = this.models[key];
    if (!item.pivot) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    const newClone = item.pivot.clone(true);
    group.add(newClone);

    const s = item.baseScale * this.scaleMultiplier;
    group.scale.set(s, s, s);
    group.userData.modelKey = key;

    if (this.currentColor) {
      this.applyColorToGroup(group, this.currentColor);
    }
  }

  /**
   * Изменение цвета PBR-материалов через .material.color.set(...)
   */
  setColor(hexColor) {
    this.currentColor = hexColor;
    this.placedObjects.forEach((group) => {
      this.applyColorToGroup(group, hexColor);
    });
  }

  applyColorToGroup(group, hexColor) {
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (hexColor) {
            m.color.set(hexColor);
          } else if (m.userData.originalColor) {
            m.color.copy(m.userData.originalColor);
          }
        });
      }
    });
  }

  rotate(deltaRad) {
    this.placedObjects.forEach((group) => {
      group.rotation.y += deltaRad;
    });
  }

  toggleAutoRotate() {
    this.autoRotateEnabled = !this.autoRotateEnabled;
    return this.autoRotateEnabled;
  }

  update(delta) {
    if (this.autoRotateEnabled) {
      this.placedObjects.forEach((group) => {
        group.rotation.y += 1.0 * delta;
      });
    }
  }

  scaleUp() {
    this.scaleMultiplier = Math.min(3.0, this.scaleMultiplier + 0.2);
    this.updatePlacedScales();
    return this.scaleMultiplier;
  }

  scaleDown() {
    this.scaleMultiplier = Math.max(0.3, this.scaleMultiplier - 0.2);
    this.updatePlacedScales();
    return this.scaleMultiplier;
  }

  resetScale() {
    this.scaleMultiplier = 1.0;
    this.updatePlacedScales();
    return this.scaleMultiplier;
  }

  updatePlacedScales() {
    this.placedObjects.forEach((group) => {
      const key = group.userData.modelKey || this.activeModelKey;
      const item = this.models[key];
      if (item) {
        const s = item.baseScale * this.scaleMultiplier;
        group.scale.set(s, s, s);
      }
    });
  }

  clearAll() {
    this.placedObjects.forEach((group) => {
      this.scene.remove(group);
    });
    this.placedObjects = [];
  }
}
