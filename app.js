// 依存ライブラリは CDN の非モジュール版を読み込んでいるため、ファイルを直接ブラウザで開くだけで動作します。
// THREE, OrbitControls, TransformControls, GLTFExporter, GLTFLoader はグローバルとして提供されます。

// --- Scene setup ---
const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const dimensionLabel = document.getElementById('dimension-label');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1f5f9);

const camera = new THREE.PerspectiveCamera(60, viewport.clientWidth / viewport.clientHeight, 0.1, 500);
camera.position.set(8, 6, 10);

const orbit = new THREE.OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 1, 0);

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.castShadow = true;
keyLight.position.set(8, 12, 8);
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

// Helpers
const gridHelper = new THREE.GridHelper(60, 60, 0xb0bec5, 0xe2e8f0);
gridHelper.material.opacity = 0.6;
gridHelper.material.transparent = true;
gridHelper.position.y = 0.01;
const axesHelper = new THREE.AxesHelper(3.5);
scene.add(gridHelper);
scene.add(axesHelper);

// Ground plane for snapping and shadows
const groundMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.9, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.receiveShadow = true;
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Controls for editing
const transform = new THREE.TransformControls(camera, renderer.domElement);
transform.setSize(0.9);
transform.addEventListener('dragging-changed', (event) => {
  // Disable orbit while transforming to prevent camera drift.
  orbit.enabled = !event.value;
});
transform.addEventListener('mouseDown', () => (isTransformDragging = true));
transform.addEventListener('mouseUp', () => (isTransformDragging = false));
transform.addEventListener('objectChange', () => {
  if (snapToggle.checked && selected) {
    snapObject(selected);
  }
  updateDimensionLabel(selected);
});
transform.setMode('translate');
scene.add(transform);

// State containers
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const editableObjects = new Set();
let selected = null;
let drawMode = false;
let drawPoints = [];
let previewLine = null;
let previewDots = [];
let isTransformDragging = false;

// --- UI wiring ---
const addBoxBtn = document.getElementById('add-box');
const addSphereBtn = document.getElementById('add-sphere');
const addCylinderBtn = document.getElementById('add-cylinder');
const startDrawBtn = document.getElementById('start-draw');
const finishDrawBtn = document.getElementById('finish-draw');
const cancelDrawBtn = document.getElementById('cancel-draw');
const extrudeHeightInput = document.getElementById('extrude-height');
const modeButtons = Array.from(document.querySelectorAll('.mode-button'));
const deleteBtn = document.getElementById('delete-selected');
const resetCameraBtn = document.getElementById('reset-camera');
const duplicateBtn = document.getElementById('duplicate-selected');
const colorPicker = document.getElementById('color-picker');
const snapToggle = document.getElementById('snap-toggle');
const snapStepInput = document.getElementById('snap-step');
const viewButtons = Array.from(document.querySelectorAll('.view-button'));
const toggleGrid = document.getElementById('toggle-grid');
const toggleAxes = document.getElementById('toggle-axes');
const exportJsonBtn = document.getElementById('export-json');
const importJsonBtn = document.getElementById('import-json');
const exportGltfBtn = document.getElementById('export-gltf');
const importFileInput = document.getElementById('import-file');
const importSkpBtn = document.getElementById('import-skp');
const exportSkpBtn = document.getElementById('export-skp');

addBoxBtn.addEventListener('click', () => createPrimitive('box'));
addSphereBtn.addEventListener('click', () => createPrimitive('sphere'));
addCylinderBtn.addEventListener('click', () => createPrimitive('cylinder'));
startDrawBtn.addEventListener('click', beginDrawMode);
finishDrawBtn.addEventListener('click', finalizePolygon);
cancelDrawBtn.addEventListener('click', cancelDrawing);
modeButtons.forEach((btn) => btn.addEventListener('click', () => switchTransformMode(btn.dataset.mode, btn)));
deleteBtn.addEventListener('click', deleteSelection);
resetCameraBtn.addEventListener('click', resetCamera);
duplicateBtn.addEventListener('click', duplicateSelection);
colorPicker.addEventListener('input', applyColorToSelection);
snapStepInput.addEventListener('change', () => setStatus(`スナップ間隔: ${snapStepInput.value}m`));
snapToggle.addEventListener('change', () =>
  setStatus(snapToggle.checked ? 'スナップ: ON (移動時に丸め)' : 'スナップ: OFF')
);
viewButtons.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view, btn)));
toggleGrid.addEventListener('change', () => (gridHelper.visible = toggleGrid.checked));
toggleAxes.addEventListener('change', () => (axesHelper.visible = toggleAxes.checked));
exportJsonBtn.addEventListener('click', () => downloadSceneJSON());
importJsonBtn.addEventListener('click', () => importFileInput.click());
exportGltfBtn.addEventListener('click', exportGLTF);
importFileInput.addEventListener('change', handleFileImport);

// SKP guidance: show clear message that native support is unavailable.
const skpMessage = 'SKP は SketchUp 固有形式のためブラウザ単体では直接扱えません。glTF または JSON で保存し、必要に応じて外部変換ツールをご利用ください。';
importSkpBtn.addEventListener('click', () => alert(skpMessage));
exportSkpBtn.addEventListener('click', () => alert(skpMessage));

// プレースホルダーとして直方体を1つ配置しておく
createPrimitive('box');

// Pointer interactions
renderer.domElement.addEventListener('pointerdown', onPointerDown);
window.addEventListener('resize', onResize);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelection();
  }
});

animate();

// --- Functions ---
function onResize() {
  const { clientWidth, clientHeight } = viewport;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

function createPrimitive(kind) {
  const material = new THREE.MeshStandardMaterial({ color: 0x6ee7ff, metalness: 0.05, roughness: 0.65 });
  let geometry;

  switch (kind) {
    case 'box':
      geometry = new THREE.BoxGeometry(2, 1.2, 1.2);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.9, 36, 28);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 28);
      break;
    default:
      return;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(0, geometry.parameters.height ? geometry.parameters.height / 2 : 1, 0);
  mesh.userData = { type: 'primitive', kind, params: { ...geometry.parameters }, color: material.color.getHex() };

  scene.add(mesh);
  editableObjects.add(mesh);
  select(mesh);
  setStatus(`${labelForKind(kind)} を追加しました。`);
}

function labelForKind(kind) {
  if (kind === 'gltf') return 'インポートモデル';
  if (kind === 'box') return '直方体';
  if (kind === 'sphere') return '球';
  if (kind === 'cylinder') return '円柱';
  return 'オブジェクト';
}

function beginDrawMode() {
  drawMode = true;
  drawPoints = [];
  clearPreview();
  finishDrawBtn.disabled = false;
  cancelDrawBtn.disabled = false;
  startDrawBtn.disabled = true;
  setStatus('グリッド上をクリックして頂点を配置。最低3点で押し出し可能です。');
}

function onPointerDown(event) {
  // Ignore selection while a transform handle is being dragged to avoid flicker.
  if (isTransformDragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  if (drawMode) {
    const point = intersectGround();
    if (point) {
      drawPoints.push(point);
      updatePreview();
    }
    return;
  }

  // Selection handling
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(Array.from(editableObjects));
  if (intersects.length > 0) {
    const target = findEditableRoot(intersects[0].object) ?? intersects[0].object;
    select(target);
  } else {
    select(null);
  }
}

function intersectGround() {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, point);
  if (!point) return null;
  return new THREE.Vector3(point.x, 0, point.z);
}

function updatePreview() {
  clearPreview();
  if (drawPoints.length === 0) return;

  const material = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 });
  const points = drawPoints.map((p) => p.clone());
  if (drawPoints.length > 1) {
    points.push(drawPoints[0].clone());
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  previewLine = new THREE.LineLoop(geometry, material);
  scene.add(previewLine);

  // Mark vertices for clarity.
  const dotMaterial = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0ea5e9 });
  previewDots = drawPoints.map((p) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), dotMaterial);
    dot.position.copy(p);
    scene.add(dot);
    return dot;
  });
}

function clearPreview() {
  if (previewLine) {
    scene.remove(previewLine);
    previewLine.geometry.dispose();
    previewLine = null;
  }
  previewDots.forEach((dot) => {
    scene.remove(dot);
    dot.geometry.dispose();
  });
  previewDots = [];
}

function finalizePolygon() {
  if (!drawMode || drawPoints.length < 3) {
    setStatus('ポリゴンは3点以上が必要です。');
    return;
  }

  const shape = new THREE.Shape(drawPoints.map((p) => new THREE.Vector2(p.x, p.z)));
  const height = Number.parseFloat(extrudeHeightInput.value) || 1;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.8, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = height / 2;
  mesh.userData = {
    type: 'extrude',
    params: {
      points: drawPoints.map((p) => ({ x: p.x, z: p.z })),
      height,
    },
    color: material.color.getHex(),
  };

  scene.add(mesh);
  editableObjects.add(mesh);
  select(mesh);

  drawMode = false;
  drawPoints = [];
  clearPreview();
  startDrawBtn.disabled = false;
  finishDrawBtn.disabled = true;
  cancelDrawBtn.disabled = true;
  setStatus('押し出し完了。選択して移動/回転/スケールできます。');
}

function cancelDrawing() {
  drawMode = false;
  drawPoints = [];
  clearPreview();
  startDrawBtn.disabled = false;
  finishDrawBtn.disabled = true;
  cancelDrawBtn.disabled = true;
  setStatus('描画をキャンセルしました。');
}

function select(object) {
  if (selected && selected.material) {
    selected.material.emissive?.set(0x000000);
  }
  selected = object;

  if (!object) {
    transform.detach();
    setStatus('何も選択されていません。');
    updateDimensionLabel(null);
    return;
  }

  if (object.material && object.material.emissive) {
    object.material.emissive.setHex(0x145385);
  }
  transform.attach(object);
  // Reflect color to picker (first mesh material color if available).
  const color = extractColor(object);
  if (color) {
    colorPicker.value = `#${color.getHexString()}`;
  }
  updateDimensionLabel(object);
  setStatus(`${labelForKind(object.userData.kind || 'オブジェクト')} を選択中。`);
}

function switchTransformMode(mode, activeButton) {
  transform.setMode(mode);
  modeButtons.forEach((btn) => btn.classList.toggle('active', btn === activeButton));
}

function switchView(view, activeButton) {
  const preset = {
    iso: new THREE.Vector3(8, 6, 10),
    top: new THREE.Vector3(0, 12, 0.001),
    front: new THREE.Vector3(0, 6, 12),
    right: new THREE.Vector3(12, 6, 0),
  }[view];

  if (preset) {
    camera.position.copy(preset);
    orbit.target.set(0, 1, 0);
    orbit.update();
    viewButtons.forEach((btn) => btn.classList.toggle('active', btn === activeButton));
    setStatus(`ビュー: ${view.toUpperCase()}`);
  }
}

function deleteSelection() {
  if (!selected) return;
  transform.detach();
  editableObjects.delete(selected);
  disposeObject(selected);
  scene.remove(selected);
  selected = null;
  setStatus('選択を削除しました。');
  updateDimensionLabel(null);
}

function duplicateSelection() {
  if (!selected) return;
  const clone = selected.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      child.geometry = child.geometry.clone();
      child.material = child.material.clone();
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  clone.position.add(new THREE.Vector3(0.5, 0, 0.5));
  clone.userData = { ...selected.userData, duplicated: true };
  scene.add(clone);
  editableObjects.add(clone);
  select(clone);
  setStatus('選択を複製しました。');
}

function applyColorToSelection() {
  if (!selected) return;
  const color = new THREE.Color(colorPicker.value);
  applyColor(selected, color);
  if (selected.userData) selected.userData.color = color.getHex();
  setStatus('色を適用しました。');
}

function resetCamera() {
  camera.position.set(8, 6, 10);
  orbit.target.set(0, 1, 0);
  orbit.update();
  setStatus('カメラをリセットしました。');
}

function setStatus(text) {
  statusEl.textContent = text;
}

// --- Export / Import ---
function downloadSceneJSON() {
  const payload = {
    version: 1,
    objects: Array.from(editableObjects)
      .filter((obj) => obj.userData.type === 'primitive' || obj.userData.type === 'extrude')
      .map(serializeObject),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'scene.json');
  const skipped = editableObjects.size - payload.objects.length;
  setStatus(
    skipped > 0
      ? 'JSON保存: 一部のインポートモデルは含まれていません（glTFで保存してください）。'
      : 'シーンを JSON として保存しました。'
  );
}

function serializeObject(obj) {
  const base = {
    type: obj.userData.type,
    kind: obj.userData.kind,
    params: obj.userData.params,
    color: obj.userData.color,
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray(),
  };
  return base;
}

function handleFileImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'json') {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        loadFromJSON(data);
        setStatus(`${file.name} を読み込みました。`);
      } catch (error) {
        console.error(error);
        alert('読み込みに失敗しました。JSON を確認してください。');
      }
    };
    reader.readAsText(file);
  } else if (ext === 'gltf' || ext === 'glb') {
    const reader = new FileReader();
    reader.onload = () => loadGLTFFromBuffer(reader.result, ext, file.name);
    reader.readAsArrayBuffer(file);
  } else {
    alert('対応形式: JSON / glTF(.gltf, .glb)');
  }

  importFileInput.value = '';
}

function loadFromJSON(data) {
  editableObjects.forEach((obj) => {
    scene.remove(obj);
    obj.geometry?.dispose();
    if (obj.material?.dispose) obj.material.dispose();
  });
  editableObjects.clear();
  if (!data?.objects) return;

  data.objects.forEach((entry) => {
    let mesh;
    if (entry.type === 'primitive') {
      mesh = createPrimitiveFromData(entry);
    } else if (entry.type === 'extrude') {
      mesh = createExtrudeFromData(entry);
    }
    if (mesh) {
      mesh.position.fromArray(entry.position);
      mesh.rotation.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]);
      mesh.scale.fromArray(entry.scale);
      scene.add(mesh);
      editableObjects.add(mesh);
    }
  });
  select(null);
}

function createPrimitiveFromData(entry) {
  let geometry;
  const params = entry.params || {};
  switch (entry.kind) {
    case 'box':
      geometry = new THREE.BoxGeometry(params.width || 1, params.height || 1, params.depth || 1);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(params.radius || 1, 36, 28);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(
        params.radiusTop || 1,
        params.radiusBottom || params.radiusTop || 1,
        params.height || 1,
        28
      );
      break;
    default:
      return null;
  }
  const material = new THREE.MeshStandardMaterial({ color: entry.color ?? 0x6ee7ff, metalness: 0.05, roughness: 0.65 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { type: 'primitive', kind: entry.kind, params, color: entry.color };
  return mesh;
}

function createExtrudeFromData(entry) {
  const params = entry.params || {};
  const points = (params.points || []).map((p) => new THREE.Vector2(p.x, p.z));
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points);
  const depth = params.height || 1;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: entry.color ?? 0x93c5fd, roughness: 0.8, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = depth / 2;
  mesh.userData = { type: 'extrude', params, color: entry.color };
  return mesh;
}

async function loadGLTFFromBuffer(buffer, ext, filename) {
  const loader = new THREE.GLTFLoader();
  const mime = ext === 'glb' ? 'model/gltf-binary' : 'model/gltf+json';
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);

  loader.load(
    url,
    (gltf) => {
      const root = gltf.scene;
      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      root.userData = { type: 'gltf', name: filename, kind: 'gltf' };
      scene.add(root);
      editableObjects.add(root);
      select(root);
      setStatus(`${filename} を glTF として読み込みました。`);
      URL.revokeObjectURL(url);
    },
    undefined,
    (error) => {
      console.error(error);
      alert('glTF の読み込みに失敗しました。');
      URL.revokeObjectURL(url);
    }
  );
}

function exportGLTF() {
  // Export only user-created objects to keep helpers out of the file.
  const exportScene = new THREE.Scene();
  editableObjects.forEach((obj) => exportScene.add(obj.clone()));
  const exporter = new THREE.GLTFExporter();
  exporter.parse(
    exportScene,
    (result) => {
      const json = JSON.stringify(result, null, 2);
      downloadBlob(new Blob([json], { type: 'model/gltf+json' }), 'scene.gltf');
      setStatus('glTF を書き出しました。');
    },
    (error) => {
      console.error(error);
      alert('glTF の書き出しに失敗しました');
    },
    { binary: false }
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function snapObject(obj) {
  const step = Number.parseFloat(snapStepInput.value) || 0.25;
  obj.position.set(
    Math.round(obj.position.x / step) * step,
    Math.round(obj.position.y / step) * step,
    Math.round(obj.position.z / step) * step
  );
}

function updateDimensionLabel(obj) {
  if (!obj) {
    dimensionLabel.textContent = '選択中: なし';
    return;
  }
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const format = (v) => v.toFixed(2);
  dimensionLabel.textContent = `幅 ${format(size.x)}m / 高さ ${format(size.y)}m / 奥行 ${format(size.z)}m`;
}

function applyColor(target, color) {
  target.traverse((child) => {
    if (child.isMesh && child.material && child.material.color) {
      child.material.color.copy(color);
      if (child.material.emissive) {
        child.material.emissive.set(0x000000);
      }
    }
  });
}

function extractColor(target) {
  let found = null;
  target.traverse((child) => {
    if (found) return;
    if (child.isMesh && child.material && child.material.color) {
      found = child.material.color.clone();
    }
  });
  return found;
}

function disposeObject(target) {
  target.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (child.material?.dispose) child.material.dispose();
    }
  });
}

function findEditableRoot(object) {
  let current = object;
  while (current) {
    if (editableObjects.has(current)) return current;
    current = current.parent;
  }
  return null;
}
