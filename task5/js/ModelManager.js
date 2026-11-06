import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * ModelManager — модуль управления 3D-моделями.
 * Отвечает за:
 * - Загрузку glTF/GLB файлов и PBR-материалов.
 * - Очистку от сторонних мешей (мусорные колеса в glb).
 * - Нормализацию масштаба и центрирование точки опоры (шасси/подошва на Y=0).
 * - Размещение объектов по координатам Hit-Test.
 * - Смену активной модели в реальном времени.
 * - Поворот и авто-вращение.
 * - Изменение PBR-цвета через .material.color.set(...).
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
        baseScale: 0.08, // Будет автоматически скорректирован до ~55 см
        pivot: null
      },
      mask: {
        name: 'Японская маска',
        url: './assets/mask.glb',
        baseScale: 0.35, // Размер маски ~70 см (откалиброван)
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
   * Предзагрузка моделей и подготовка их опорных точек (pivot)
   */
  initPreload() {
    Object.keys(this.models).forEach((key) => {
      const item = this.models[key];

      this.loader.load(
        item.url,
        (gltf) => {
          const root = gltf.scene;

          if (key === 'drone') {
            // Удаляем мусорные меши (колеса автомобиля, оставшиеся в glb на координатах > 500)
            const junkMeshes = [];
            root.traverse((child) => {
              if (child.isMesh) {
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                const b = child.geometry.boundingBox;
                const maxDim = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
                if (maxDim > 50 || child.name.toLowerCase().includes('pneu')) {
                  junkMeshes.push(child);
                }
              }
            });
            junkMeshes.forEach((m) => {
              if (m.parent) m.parent.remove(m);
            });

            // Расчет реальных габаритов самого дрона
            const box = new THREE.Box3().setFromObject(root);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // Центрируем дрон: ножки строго на Y = 0, центр по X и Z
            root.position.x = -center.x;
            root.position.z = -center.z;
            root.position.y = -box.min.y;

            // Базовый масштаб: размах винтов реального DJI FPV ~55 см (0.55 м)
            item.baseScale = size.x > 0 ? (0.55 / size.x) : 0.08;
            console.log(`[ModelManager] Дрон откалиброван: размер ${size.x.toFixed(2)} -> baseScale: ${item.baseScale.toFixed(4)}`);
          } else {
            // Для маски
            const box = new THREE.Box3().setFromObject(root);
            const center = box.getCenter(new THREE.Vector3());

            root.position.x = -center.x;
            root.position.z = -center.z;
            root.position.y = -box.min.y;

            item.baseScale = 0.35; // Комфортный размер маски ~70 см
          }

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

          // Создаем контейнер-опору (pivot)
          const pivot = new THREE.Group();
          pivot.add(root);
          item.pivot = pivot;

          console.log(`[ModelManager] Модель ${item.name} успешно готова`);
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

    console.log(`[ModelManager] Объект ${item.name} размещен (всего: ${this.placedObjects.length}), scale: ${s.toFixed(4)}`);
    return group;
  }

  /**
   * Переключение активной модели в реальном времени
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
   * Замена модели внутри существующего контейнера с сохранением координат
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
   * Поворот объектов на заданный угол
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

  update(delta) {
    if (this.autoRotateEnabled) {
      this.placedObjects.forEach((group) => {
        group.rotation.y += 1.0 * delta;
      });
    }
  }

  /**
   * Регулировка масштаба
   */
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

  /**
   * Очистить размещенные объекты
   */
  clearAll() {
    this.placedObjects.forEach((group) => {
      this.scene.remove(group);
    });
    this.placedObjects = [];
  }
}
