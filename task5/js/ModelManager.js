import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * ModelManager — модуль управления 3D-моделями.
 * Отвечает за:
 * - Загрузку glTF/GLB файлов и PBR-материалов.
 * - Нормализацию масштаба и центрирование точки опоры (pivot).
 * - Размещение объектов по координатам Hit-Test.
 * - Смену активной модели в реальном времени.
 * - Поворот (пошаговый и плавный авто-поворот).
 * - Изменение PBR-цвета через material.color.set(...).
 * - Масштабирование объектов.
 */
export class ModelManager {
  constructor(scene) {
    this.scene = scene;
    this.loader = new GLTFLoader();

    // Загруженные шаблоны моделей
    this.models = {
      drone: {
        name: 'DJI FPV Дрон',
        url: './assets/drone.glb',
        baseScale: 0.0006, // Масштабирование ~1.0 м в размахе
        pivot: null
      },
      mask: {
        name: 'Японская маска',
        url: './assets/mask.glb',
        baseScale: 0.35,   // Высота ~0.7 м
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
   * Предзагрузка моделей и подготовка их опорных точек
   */
  initPreload() {
    Object.keys(this.models).forEach((key) => {
      const item = this.models[key];

      this.loader.load(
        item.url,
        (gltf) => {
          const root = gltf.scene;

          // Расчет Bounding Box для центрирования на полу
          const box = new THREE.Box3().setFromObject(root);
          const center = box.getCenter(new THREE.Vector3());

          // Смещаем саму модель так, чтобы точка привязки была строго по центру снизу
          root.position.x = -center.x;
          root.position.z = -center.z;
          root.position.y = -box.min.y;

          // Сохраняем исходные цвета материалов для возможности возврата к оригиналу
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

          // Создаем контейнер-опору (pivot)
          const pivot = new THREE.Group();
          pivot.add(root);
          item.pivot = pivot;

          console.log(`[ModelManager] Модель ${item.name} успешно загружена и готова`);
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

    // Задаем выверенный масштаб
    const s = item.baseScale * this.scaleMultiplier;
    group.scale.set(s, s, s);
    group.userData.modelKey = this.activeModelKey;

    // Применяем выбранный PBR-цвет, если он задан
    if (this.currentColor) {
      this.applyColorToGroup(group, this.currentColor);
    }

    this.scene.add(group);
    this.placedObjects.push(group);

    console.log(`[ModelManager] Объект ${item.name} размещен (всего: ${this.placedObjects.length})`);
    return group;
  }

  /**
   * Переключение активной модели
   */
  setActiveModel(key) {
    if (!this.models[key]) return;
    this.activeModelKey = key;

    // Если на полу уже есть объекты, заменяем их на выбранную модель
    this.placedObjects.forEach((group) => {
      this.replaceModelInGroup(group, key);
    });
  }

  /**
   * Замена модели внутри существующего контейнера с сохранением позиции
   */
  replaceModelInGroup(group, key) {
    const item = this.models[key];
    if (!item.pivot) return;

    // Удаляем предыдущую модель из группы
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    // Вставляем новую модель
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

  /**
   * Поворот объектов на заданный угол (в радианах)
   */
  rotate(deltaRad) {
    this.placedObjects.forEach((group) => {
      group.rotation.y += deltaRad;
    });
  }

  /**
   * Переключение авто-вращения
   */
  toggleAutoRotate() {
    this.autoRotateEnabled = !this.autoRotateEnabled;
    return this.autoRotateEnabled;
  }

  /**
   * Обновление покадровой анимации (вызывается в animation loop)
   */
  update(delta) {
    if (this.autoRotateEnabled) {
      this.placedObjects.forEach((group) => {
        group.rotation.y += 1.0 * delta;
      });
    }
  }

  /**
   * Управление масштабом
   */
  scaleUp() {
    this.scaleMultiplier = Math.min(2.5, this.scaleMultiplier + 0.2);
    this.updatePlacedScales();
    return this.scaleMultiplier;
  }

  scaleDown() {
    this.scaleMultiplier = Math.max(0.4, this.scaleMultiplier - 0.2);
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

  /**
   * Очистить все размещенные объекты со сцены
   */
  clearAll() {
    this.placedObjects.forEach((group) => {
      this.scene.remove(group);
    });
    this.placedObjects = [];
  }
}
