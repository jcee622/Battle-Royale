import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const canvas = document.querySelector("#screen");
const minimap = document.querySelector("#minimap");
const map = minimap.getContext("2d");
const $ = selector => document.querySelector(selector);
const TILE = 4;
const GRID = 24;
const WORLD = GRID * TILE;
const BOT_COUNT = 9;
const FOV = 82;
const keys = new Set();
const blockers = [];
const pickups = [];
const bots = [];
const scenery = [];
const raycaster = new THREE.Raycaster();
const aimPoint = new THREE.Vector2();
const movementForward = new THREE.Vector3();
const movementRight = new THREE.Vector3();
const clock = new THREE.Clock();
const touchMode = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
const materials = {};
const buildingBounds = [];

let renderer;
let scene;
let camera;
let weapon;
let muzzleLight;
let zoneRing;
let player;
let running = false;
let paused = false;
let kills = 0;
let time = 0;
let zoneRadius = 44.8;
let zoneMode = "wait";
let zoneTimer = 105;
let reloadTimer = 0;
let noticeTimer = 0;
let recoil = 0;
let walkPhase = 0;
let swayX = 0;
let swayY = 0;
let damageTimer = 0;
let lastHudTick = 0;
let fallbackInput = false;
let pointerLockActive = false;
let dragging = false;
let touchLookPointer = null;
let touchMovePointer = null;
let touchFirePointer = null;
let touchFiring = false;
let touchFireTimer = 0;
const touchMovement = { forward: 0, sideways: 0 };
let lastMouseX = 0;
let lastMouseY = 0;
let sun;
let sky;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const random = (min, max) => min + Math.random() * (max - min);

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeTexture(draw, size = 512, repeat = 1) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureCanvas.height = size;
  const textureContext = textureCanvas.getContext("2d");
  draw(textureContext, size);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function valueNoise(randomSource, size, cells) {
  const grid = Array.from({ length: cells * cells }, () => randomSource());
  const smooth = value => value * value * (3 - 2 * value);
  return (x, y) => {
    const sx = x / size * cells;
    const sy = y / size * cells;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = smooth(sx - ix);
    const fy = smooth(sy - iy);
    const at = (gx, gy) => grid[((gy % cells + cells) % cells) * cells + ((gx % cells + cells) % cells)];
    const upper = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const lower = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return upper * (1 - fy) + lower * fy;
  };
}

function makeGrassTexture() {
  const size = 512;
  const coarse = valueNoise(seeded(1851), size, 8);
  const medium = valueNoise(seeded(1963), size, 32);
  const fine = valueNoise(seeded(2819), size, 128);
  const grain = seeded(4159);
  return makeTexture((context) => {
    const pixels = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const broad = (coarse(x, y) - .5) * 38;
        const detail = (medium(x, y) - .5) * 20;
        const blade = (fine(x, y) - .5) * 11 + (grain() - .5) * 8;
        const shade = broad + detail + blade;
        const index = (y * size + x) * 4;
        pixels.data[index] = clamp(91 + shade, 0, 255);
        pixels.data[index + 1] = clamp(103 + shade, 0, 255);
        pixels.data[index + 2] = clamp(68 + shade * .78, 0, 255);
        pixels.data[index + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    context.globalAlpha = .25;
    for (let i = 0; i < 6500; i++) {
      const x = grain() * size;
      const y = grain() * size;
      const length = 2 + grain() * 8;
      context.strokeStyle = grain() > .5 ? "#c1bf7a" : "#253c26";
      context.lineWidth = .4 + grain() * .8;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + (grain() - .5) * 2.4, y - length);
      context.stroke();
    }
    context.globalAlpha = 1;
  }, size, 18);
}

function makeSidingTexture() {
  const rng = seeded(473);
  return makeTexture((context, size) => {
    context.fillStyle = "#9a927d";
    context.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 25) {
      const light = Math.floor(rng() * 20) - 10;
      context.fillStyle = `rgb(${154 + light},${146 + light},${124 + light})`;
      context.fillRect(0, y + 1, size, 23);
      context.fillStyle = "#554f43";
      context.fillRect(0, y + 23, size, 2);
      for (let x = 0; x < size; x += 90) {
        context.fillStyle = "#746d5e";
        context.fillRect(x + 1, y + 4, 1, 17);
      }
    }
    for (let i = 0; i < 14000; i++) {
      const x = rng() * size;
      const y = rng() * size;
      context.fillStyle = rng() > .5 ? "#d5c7a344" : "#282b2940";
      context.fillRect(x, y, 1 + rng() * 2, 1);
    }
  }, 512, 1);
}

function makeRoofTexture() {
  const rng = seeded(828);
  return makeTexture((context, size) => {
    context.fillStyle = "#45453d";
    context.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 28) {
      const offset = (Math.floor(y / 28) % 2) * 18;
      for (let x = -20 + offset; x < size; x += 36) {
        const variation = Math.floor(rng() * 24);
        context.fillStyle = `rgb(${83 + variation},${79 + variation},${68 + variation})`;
        context.fillRect(x + 1, y + 1, 34, 25);
        context.fillStyle = "#30312c";
        context.fillRect(x + 1, y + 25, 34, 3);
        context.fillStyle = "#c6b68b28";
        context.fillRect(x + 4, y + 2, 23, 1);
      }
    }
  }, 512, 2);
}

function makeMaterials() {
  const grass = makeGrassTexture();
  const siding = makeSidingTexture();
  const roof = makeRoofTexture();
  materials.grass = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
  materials.sand = new THREE.MeshStandardMaterial({ color: 0x998b70, roughness: 1 });
  materials.wall = new THREE.MeshStandardMaterial({ map: siding, roughness: .9 });
  materials.plaster = new THREE.MeshStandardMaterial({ color: 0xa99d82, map: siding, roughness: .89 });
  materials.concrete = new THREE.MeshStandardMaterial({ color: 0x929287, map: siding, roughness: .94 });
  materials.roof = new THREE.MeshStandardMaterial({ map: roof, roughness: .95, side: THREE.DoubleSide });
  materials.wood = new THREE.MeshStandardMaterial({ color: 0x65533d, roughness: .9 });
  materials.trim = new THREE.MeshStandardMaterial({ color: 0xddd0ad, roughness: .76 });
  materials.glass = new THREE.MeshStandardMaterial({ color: 0x577078, roughness: .27, metalness: .17 });
  materials.darkGlass = new THREE.MeshStandardMaterial({ color: 0x273940, roughness: .3, metalness: .12 });
  materials.bark = new THREE.MeshStandardMaterial({ color: 0x68543c, roughness: 1 });
  materials.leaves = [
    new THREE.MeshStandardMaterial({ color: 0x425a3b, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x536742, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x64744a, roughness: 1 })
  ];
  materials.stone = new THREE.MeshStandardMaterial({ color: 0x73756b, roughness: 1 });
}

function box(name, dimensions, position, material, parent = scene, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeWindow(parent, x, y, z, rotation = 0, width = .82, height = .92) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotation;
  parent.add(group);
  box("window recess", [width + .12, height + .12, .05], [0, 0, 0], materials.wood, group, false);
  box("window glass", [width, height, .045], [0, 0, .028], materials.glass, group, false);
  for (const side of [-1, 1]) box("window frame", [.055, height + .14, .07], [side * (width / 2 + .025), 0, .057], materials.trim, group, false);
  for (const side of [-1, 1]) box("window sill", [width + .16, .05, .1], [0, side * (height / 2 + .055), .065], materials.trim, group, false);
  box("window mullion", [.035, height, .09], [0, 0, .08], materials.trim, group, false);
  box("window mullion", [width, .035, .09], [0, 0, .08], materials.trim, group, false);
  return group;
}

function addGableRoof(parent, width, depth, wallHeight, ridgeHeight) {
  const eave = wallHeight - .12;
  const ridge = wallHeight + ridgeHeight;
  const positions = [
    -width / 2, eave, -depth / 2, 0, ridge, -depth / 2, 0, ridge, depth / 2, -width / 2, eave, depth / 2,
    width / 2, eave, -depth / 2, 0, ridge, -depth / 2, 0, ridge, depth / 2, width / 2, eave, depth / 2
  ];
  const indices = [0, 2, 1, 0, 3, 2, 4, 6, 7, 4, 5, 6];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, .5, 0, .5, 1, 0, 1,
    1, 0, 1, 1, .5, 1, .5, 0
  ], 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const roof = new THREE.Mesh(geometry, materials.roof);
  roof.position.y = 0;
  roof.castShadow = true;
  roof.receiveShadow = true;
  parent.add(roof);
  const endShape = new THREE.Shape();
  endShape.moveTo(-width / 2, eave);
  endShape.lineTo(width / 2, eave);
  endShape.lineTo(0, ridge);
  endShape.closePath();
  const gableGeometry = new THREE.ShapeGeometry(endShape);
  const front = new THREE.Mesh(gableGeometry, materials.plaster);
  front.position.z = -depth / 2 + .015;
  front.castShadow = true;
  parent.add(front);
  const back = new THREE.Mesh(gableGeometry, materials.plaster);
  back.position.z = depth / 2 - .015;
  back.rotation.y = Math.PI;
  back.castShadow = true;
  parent.add(back);
  const ridgeBeam = box("roof ridge", [width + .18, .13, .16], [0, ridge, 0], materials.wood, parent);
  ridgeBeam.castShadow = true;
  for (const z of [-depth / 2, depth / 2]) {
    box("roof fascia", [width + .1, .16, .12], [0, eave, z], materials.wood, parent);
  }
}

function createBuilding(tileX, tileZ, widthTiles, depthTiles, variant) {
  const width = widthTiles * TILE;
  const depth = depthTiles * TILE;
  const height = variant === 0 ? 3.35 : 3.65;
  const centerX = (tileX + widthTiles / 2) * TILE;
  const centerZ = (tileZ + depthTiles / 2) * TILE;
  const building = new THREE.Group();
  building.position.set(centerX, 0, centerZ);
  scene.add(building);

  const facade = variant === 0 ? materials.wall : variant === 1 ? materials.plaster : materials.concrete;
  const body = box("building walls", [width, height, depth], [0, height / 2, 0], facade, building);
  blockers.push(body);
  buildingBounds.push({ minX: centerX - width / 2, maxX: centerX + width / 2, minZ: centerZ - depth / 2, maxZ: centerZ + depth / 2 });
  box("foundation", [width + .18, .25, depth + .18], [0, .12, 0], materials.concrete, building);

  const countX = Math.max(1, Math.floor(width / 2.3));
  for (const side of [-1, 1]) {
    const frontZ = side * (depth / 2 + .035);
    for (let i = 0; i < countX; i++) {
      const windowX = (i - (countX - 1) / 2) * Math.min(2.25, width / countX);
      const skipDoor = side === -1 && i === Math.floor(countX / 2) && width > 5;
      if (!skipDoor) makeWindow(building, windowX, 2.1, frontZ, side < 0 ? Math.PI : 0, .78, .88);
    }
    const sideWindowCount = Math.max(1, Math.floor(depth / 3));
    for (let i = 0; i < sideWindowCount; i++) {
      const z = (i - (sideWindowCount - 1) / 2) * Math.min(2.7, depth / sideWindowCount);
      makeWindow(building, side * (width / 2 + .035), 2.1, z, side > 0 ? Math.PI / 2 : -Math.PI / 2, .72, .82);
    }
  }

  const doorX = width > 5 ? random(-width * .27, width * .27) : 0;
  const door = new THREE.Group();
  door.position.set(doorX, 0, -depth / 2 - .08);
  building.add(door);
  box("front door", [.88, 2.02, .11], [0, 1.06, 0], materials.wood, door);
  box("door inset", [.58, 1.5, .02], [0, 1.08, -.065], materials.plaster, door, false);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb7a474, metalness: .65, roughness: .32 }));
  knob.position.set(.29, 1.03, -.11);
  door.add(knob);
  box("front step", [1.18, .18, .58], [doorX, .09, -depth / 2 - .35], materials.stone, building);
  addGableRoof(building, width + .48, depth + .48, height + .16, 1.05);

  const chimney = box("chimney", [.48, 1.35, .5], [width * .28, height + .64, depth * .16], materials.concrete, building);
  chimney.castShadow = true;

  return building;
}

function createTree(x, z, scale = 1) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
  const trunkHeight = random(2.4, 3.6);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.14, .25, trunkHeight, 9), materials.bark);
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);
  const branchMaterial = materials.bark;
  for (let i = 0; i < 3; i++) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(.035, .09, 1.1, 7), branchMaterial);
    branch.position.set((i - 1) * .25, trunkHeight * (.64 + (i % 2) * .12), 0);
    branch.rotation.z = (i - 1) * .48;
    branch.rotation.x = (i - 1) * .22;
    branch.castShadow = true;
    tree.add(branch);
  }
  const crownGeometry = new THREE.SphereGeometry(1, 15, 11);
  const crownPositions = crownGeometry.attributes.position;
  const crownRng = seeded(Math.floor(x * 251 + z * 997));
  for (let i = 0; i < crownPositions.count; i++) {
    const perturbation = .92 + crownRng() * .17;
    crownPositions.setXYZ(
      i,
      crownPositions.getX(i) * perturbation,
      crownPositions.getY(i) * perturbation,
      crownPositions.getZ(i) * perturbation
    );
  }
  crownGeometry.computeVertexNormals();
  for (let i = 0; i < 10; i++) {
    const crown = new THREE.Mesh(crownGeometry, materials.leaves[Math.floor(Math.random() * materials.leaves.length)]);
    const angle = i * 2.4;
    const radius = i === 0 ? 0 : random(.4, 1);
    crown.position.set(Math.cos(angle) * radius, trunkHeight + random(-.15, 1), Math.sin(angle) * radius);
    crown.scale.set(random(.65, 1.05), random(.65, 1), random(.65, 1.05));
    crown.rotation.set(random(-.3, .3), random(0, Math.PI), random(-.3, .3));
    crown.castShadow = true;
    crown.receiveShadow = true;
    tree.add(crown);
  }
  scenery.push({ x, z, trunkRadius: .25 * scale });
  return tree;
}

function createRock(x, z, scale) {
  const geometry = new THREE.DodecahedronGeometry(scale, 1);
  const rock = new THREE.Mesh(geometry, materials.stone);
  rock.position.set(x, scale * .42, z);
  rock.scale.set(1.5, .85, 1);
  rock.rotation.set(random(-.2, .2), random(0, Math.PI), random(-.2, .2));
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

function createGrass() {
  const blade = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    -.018, 0, 0, .018, 0, 0, .012, .23, 0,
    -.018, 0, 0, .012, .23, 0, -.023, .19, 0
  ]);
  blade.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  blade.computeVertexNormals();
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x819064,
    roughness: 1,
    side: THREE.DoubleSide
  });
  const count = 7000;
  const instanced = new THREE.InstancedMesh(blade, grassMaterial, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rng = seeded(2359);
  let placed = 0;
  for (let attempt = 0; attempt < count * 2 && placed < count; attempt++) {
    const x = 1 + rng() * (WORLD - 2);
    const z = 1 + rng() * (WORLD - 2);
    if (buildingBounds.some(bound => x > bound.minX - .8 && x < bound.maxX + .8 && z > bound.minZ - .8 && z < bound.maxZ + .8)) continue;
    position.set(x, .015, z);
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
    const s = .35 + rng() * .75;
    scale.set(s, s, s);
    matrix.compose(position, rotation, scale);
    instanced.setMatrixAt(placed++, matrix);
    const bladeShade = .76 + rng() * .44;
    instanced.setColorAt(placed - 1, new THREE.Color(bladeShade * .93, bladeShade, bladeShade * .8));
  }
  instanced.count = placed;
  instanced.instanceMatrix.needsUpdate = true;
  instanced.receiveShadow = true;
  instanced.frustumCulled = false;
  scene.add(instanced);
}

function createDistantHills() {
  const hillMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x718172, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x839082, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x929c8e, roughness: 1 })
  ];
  const rng = seeded(716);
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2;
    const radius = 126 + rng() * 18;
    const hill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      hillMaterials[i % hillMaterials.length]
    );
    hill.position.set(Math.cos(angle) * radius, 1.5 + rng() * 2, Math.sin(angle) * radius);
    hill.scale.set(20 + rng() * 14, 3.5 + rng() * 3, 15 + rng() * 10);
    hill.rotation.y = rng() * Math.PI;
    hill.receiveShadow = true;
    scene.add(hill);
  }
}

function createWorld() {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshBasicMaterial({ color: 0x49636b })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(WORLD / 2, -.46, WORLD / 2);
  water.receiveShadow = true;
  scene.add(water);

  const shore = new THREE.Mesh(new THREE.PlaneGeometry(101, 101), materials.sand);
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(WORLD / 2, -.17, WORLD / 2);
  shore.receiveShadow = true;
  scene.add(shore);

  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD, 1, 1), materials.grass);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.set(WORLD / 2, -.1, WORLD / 2);
  terrain.receiveShadow = true;
  scene.add(terrain);
  box("distant island base", [98, .8, 98], [WORLD / 2, -.52, WORLD / 2], materials.sand, scene, false);

  const blocks = [
    [4, 4, 2, 2], [9, 3, 1, 3], [15, 3, 3, 2], [19, 7, 2, 2],
    [3, 10, 3, 1], [8, 9, 2, 3], [14, 8, 2, 3], [18, 12, 3, 1],
    [3, 15, 2, 3], [7, 17, 3, 2], [12, 14, 2, 2], [17, 17, 3, 2],
    [10, 21, 2, 1], [5, 6, 1, 1], [20, 10, 1, 1], [5, 20, 1, 1]
  ];
  blocks.forEach((block, index) => createBuilding(...block, index % 3));
  createGrass();

  const rng = seeded(5209);
  let added = 0;
  for (let attempt = 0; attempt < 280 && added < 55; attempt++) {
    const x = 2 + rng() * (WORLD - 4);
    const z = 2 + rng() * (WORLD - 4);
    if (buildingBounds.some(bound => x > bound.minX - 2.2 && x < bound.maxX + 2.2 && z > bound.minZ - 2.2 && z < bound.maxZ + 2.2)) continue;
    const edgeDistance = Math.min(x, z, WORLD - x, WORLD - z);
    if (edgeDistance < 1.4) continue;
    createTree(x, z, .72 + rng() * .55);
    added++;
  }
  for (let i = 0; i < 28; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 47 + rng() * 3;
    createRock(WORLD / 2 + Math.cos(angle) * radius, WORLD / 2 + Math.sin(angle) * radius, .5 + rng() * 1.2);
  }
  createDistantHills();

  const zoneGeometry = new THREE.TorusGeometry(1, .055, 8, 256);
  const zoneMaterial = new THREE.MeshBasicMaterial({ color: 0xc9ff3b, transparent: true, opacity: .83 });
  zoneRing = new THREE.Mesh(zoneGeometry, zoneMaterial);
  zoneRing.rotation.x = -Math.PI / 2;
  zoneRing.position.set(WORLD / 2, .08, WORLD / 2);
  scene.add(zoneRing);
}

function createHumanoid(bot) {
  const group = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: bot.uniform, roughness: .92 });
  const vest = new THREE.MeshStandardMaterial({ color: bot.vest, roughness: .88 });
  const pants = new THREE.MeshStandardMaterial({ color: bot.pants, roughness: .95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb68e6d, roughness: .92 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x302e26, roughness: .98 });
  const helmet = new THREE.MeshStandardMaterial({ color: bot.helmet, roughness: .8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252820, roughness: .82 });
  const webbing = new THREE.MeshStandardMaterial({ color: 0x34392f, roughness: .94 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4b42, roughness: .42, metalness: .65 });
  const skinShadow = new THREE.MeshStandardMaterial({ color: 0x574b3d, roughness: .9 });
  const parts = {};

  const part = (name, geometry, material, position, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const torso = part("torso", new THREE.CapsuleGeometry(.255, .49, 6, 12), uniform, [0, 1.2, 0]);
  torso.scale.set(1.08, 1, .9);
  const plate = part("armour plate", new RoundedBoxGeometry(.43, .49, .1, 3, .035), vest, [0, 1.23, .235]);
  plate.rotation.x = -.04;
  part("plate carrier upper", new RoundedBoxGeometry(.41, .09, .11, 2, .025), webbing, [0, 1.49, .22]);

  for (const side of [-1, 1]) {
    part("plate carrier strap", new RoundedBoxGeometry(.075, .38, .07, 2, .024), webbing, [side * .19, 1.47, .15]);
    const pouchX = side * .255;
    const pouch = part("magazine pouch", new RoundedBoxGeometry(.14, .18, .13, 2, .018), webbing, [pouchX, 1.12, .25]);
    pouch.rotation.y = side * -.08;
    part("pouch flap", new RoundedBoxGeometry(.11, .045, .018, 2, .008), vest, [pouchX, 1.21, .32]);
    part("radio pouch", new RoundedBoxGeometry(.11, .24, .09, 2, .018), webbing, [side * .27, 1.45, -.01]);
    const buckle = part("carrier buckle", new THREE.BoxGeometry(.04, .045, .02), metal, [side * .19, 1.46, .22]);
    buckle.material = metal;
  }
  part("belt", new THREE.CylinderGeometry(.235, .235, .105, 12), webbing, [0, .83, 0]);
  part("belt buckle", new RoundedBoxGeometry(.12, .09, .035, 2, .015), metal, [0, .84, .235]);
  part("utility pouch", new RoundedBoxGeometry(.16, .16, .11, 2, .02), webbing, [-.31, .81, .035]);
  part("holster", new THREE.BoxGeometry(.12, .27, .13), webbing, [.3, .72, 0]);
  part("backpack body", new RoundedBoxGeometry(.36, .46, .2, 3, .045), dark, [0, 1.2, -.265]);
  part("backpack lid", new RoundedBoxGeometry(.37, .13, .215, 2, .03), vest, [0, 1.43, -.27]);
  for (const side of [-1, 1]) {
    part("pack side pouch", new RoundedBoxGeometry(.11, .23, .15, 2, .025), webbing, [side * .21, 1.14, -.27]);
    part("pack strap", new RoundedBoxGeometry(.045, .4, .04, 2, .014), vest, [side * .18, 1.2, -.15]);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.72, .015);
  head.name = "head";
  group.add(head);
  part("face", new THREE.SphereGeometry(.15, 20, 14), skin, [0, .015, .018], head).scale.set(.83, 1.07, .85);
  part("jaw", new THREE.SphereGeometry(.115, 16, 10), skin, [0, -.07, .095], head).scale.set(.8, .52, .64);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x232722, roughness: .32 });
  const eyeLens = new THREE.MeshStandardMaterial({ color: 0x293a39, roughness: .22, metalness: .18 });
  for (const side of [-1, 1]) {
    part("eye", new THREE.SphereGeometry(.022, 8, 6), eyeMaterial, [side * .052, .035, .137], head);
    part("goggle rim", new THREE.BoxGeometry(.09, .072, .045), metal, [side * .055, .043, .143], head);
    part("goggle lens", new RoundedBoxGeometry(.069, .047, .012, 2, .009), eyeLens, [side * .055, .043, .17], head);
  }
  part("goggle bridge", new THREE.BoxGeometry(.035, .025, .04), webbing, [0, .04, .159], head);
  part("nose", new THREE.ConeGeometry(.027, .085, 5), skin, [0, -.012, .159], head).rotation.x = Math.PI / 2;
  part("neck", new THREE.CylinderGeometry(.09, .11, .14, 10), skinShadow, [0, 1.58, 0]);
  const helmetShell = part("helmet shell", new THREE.SphereGeometry(.195, 20, 14, 0, Math.PI * 2, 0, Math.PI * .57), helmet, [0, 1.82, 0]);
  helmetShell.scale.set(1.04, .96, 1.08);
  part("helmet front brim", new RoundedBoxGeometry(.31, .04, .16, 3, .018), helmet, [0, 1.805, .13]).rotation.x = -.12;
  part("helmet mount", new RoundedBoxGeometry(.07, .1, .07, 2, .014), webbing, [0, 1.86, .2]);
  for (const side of [-1, 1]) {
    part("helmet rail", new RoundedBoxGeometry(.17, .035, .04, 2, .012), webbing, [side * .17, 1.77, 0]);
    part("ear protection", new RoundedBoxGeometry(.07, .12, .08, 3, .02), dark, [side * .181, 1.74, .025]);
    part("ear pad", new THREE.CylinderGeometry(.047, .047, .022, 12), vest, [side * .22, 1.74, .03]).rotation.z = Math.PI / 2;
  }
  const strap = part("helmet chin strap", new THREE.TorusGeometry(.14, .012, 5, 18, Math.PI), webbing, [0, 1.73, .03]);
  strap.rotation.x = Math.PI / 2;

  const hips = part("hips", new RoundedBoxGeometry(.42, .22, .29, 3, .06), pants, [0, .78, 0]);
  hips.rotation.x = -.02;

  for (const side of [-1, 1]) {
    const shoulder = part("shoulder pad", new THREE.SphereGeometry(.135, 14, 10), vest, [side * .29, 1.43, .015]);
    shoulder.scale.set(1.12, .9, 1.12);
    part("arm patch", new RoundedBoxGeometry(.09, .1, .025, 2, .02), webbing, [side * .37, 1.39, .04]);

    const armPivot = new THREE.Group();
    armPivot.name = side < 0 ? "leftArm" : "rightArm";
    armPivot.position.set(side * .32, 1.4, .015);
    armPivot.rotation.x = -.84;
    armPivot.rotation.z = -side * .24;
    armPivot.userData.walkPose = { x: -.84, z: -side * .24 };
    group.add(armPivot);
    const upperArm = part("upper arm", new THREE.CapsuleGeometry(.083, .31, 5, 9), uniform, [0, -.2, .035], armPivot);
    upperArm.rotation.x = .1;
    const elbow = part("elbow pad", new THREE.SphereGeometry(.09, 10, 8), vest, [0, -.4, .06], armPivot);
    elbow.scale.set(1, .82, .9);

    const forearm = new THREE.Group();
    forearm.position.set(0, -.4, .06);
    forearm.rotation.x = -.48;
    forearm.rotation.z = side * .28;
    armPivot.add(forearm);
    part("forearm", new THREE.CapsuleGeometry(.065, .29, 5, 8), uniform, [0, -.19, .015], forearm);
    part("glove cuff", new RoundedBoxGeometry(.13, .09, .11, 2, .022), webbing, [0, -.34, .025], forearm);
    part("gloved hand", new RoundedBoxGeometry(.105, .13, .09, 3, .033), skinShadow, [0, -.42, .105], forearm);
    parts[armPivot.name] = armPivot;

    const legPivot = new THREE.Group();
    legPivot.name = side < 0 ? "leftLeg" : "rightLeg";
    legPivot.position.set(side * .13, .78, 0);
    legPivot.userData.walkPose = { x: 0 };
    group.add(legPivot);
    part("thigh", new THREE.CapsuleGeometry(.105, .31, 5, 9), pants, [0, -.23, 0], legPivot);
    const knee = part("knee pad", new RoundedBoxGeometry(.16, .17, .065, 3, .035), vest, [0, -.43, .08], legPivot);
    knee.rotation.x = -.06;
    const lowerLeg = new THREE.Group();
    lowerLeg.name = side < 0 ? "leftCalf" : "rightCalf";
    lowerLeg.position.set(0, -.47, 0);
    legPivot.add(lowerLeg);
    part("calf", new THREE.CapsuleGeometry(.075, .31, 5, 8), pants, [0, -.2, 0], lowerLeg);
    part("boot", new RoundedBoxGeometry(.19, .15, .33, 3, .036), boot, [0, -.41, .055], lowerLeg);
    part("boot sole", new RoundedBoxGeometry(.195, .036, .34, 2, .009), dark, [0, -.49, .055], lowerLeg);
    parts[legPivot.name] = legPivot;
    parts[lowerLeg.name] = lowerLeg;
  }

  const rifle = new THREE.Group();
  rifle.name = "bot rifle";
  rifle.position.set(.105, 1.17, .34);
  const rifleBody = part("rifle receiver", new RoundedBoxGeometry(.14, .13, .38, 3, .025), dark, [0, 0, 0], rifle);
  rifleBody.rotation.y = 0;
  part("rifle upper", new RoundedBoxGeometry(.12, .045, .32, 2, .012), metal, [0, .078, .015], rifle);
  part("rifle handguard", new RoundedBoxGeometry(.115, .105, .25, 2, .018), webbing, [0, .012, .29], rifle);
  part("rifle stock", new RoundedBoxGeometry(.105, .11, .23, 2, .02), materials.wood, [0, 0, -.3], rifle);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.024, .03, .43, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, .035, .59);
  barrel.castShadow = true;
  rifle.add(barrel);
  const sight = part("rifle sight", new RoundedBoxGeometry(.065, .07, .08, 2, .012), metal, [0, .145, .06], rifle);
  sight.rotation.x = -.04;
  part("rifle magazine", new RoundedBoxGeometry(.095, .2, .13, 2, .02), dark, [0, -.16, .03], rifle).rotation.x = -.12;
  part("rifle grip", new RoundedBoxGeometry(.075, .15, .085, 2, .018), dark, [0, -.135, -.11], rifle).rotation.x = -.24;
  part("rifle front post", new RoundedBoxGeometry(.025, .12, .025, 2, .006), metal, [0, .105, .49], rifle);
  part("rifle front ears", new RoundedBoxGeometry(.11, .025, .035, 2, .006), metal, [0, .075, .49], rifle);
  part("charging handle", new RoundedBoxGeometry(.07, .045, .06, 2, .01), metal, [-.09, .04, -.07], rifle);
  part("ejection port", new RoundedBoxGeometry(.014, .055, .14, 2, .006), webbing, [.075, .015, .025], rifle);
  part("selector switch", new THREE.CylinderGeometry(.035, .035, .018, 12), metal, [.075, -.02, -.105], rifle).rotation.z = Math.PI / 2;
  for (const z of [.17, .24, .31, .38, .45]) {
    part("handguard vent", new RoundedBoxGeometry(.015, .035, .035, 2, .007), dark, [.061, .015, z], rifle);
    part("handguard vent", new RoundedBoxGeometry(.015, .035, .035, 2, .007), dark, [-.061, .015, z], rifle);
  }
  for (const z of [-.08, .015]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .015, 12), metal);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(.077, -.01, z);
    rifle.add(pin);
  }
  const muzzleFlash = new THREE.Mesh(
    new THREE.ConeGeometry(.075, .25, 7),
    new THREE.MeshBasicMaterial({ color: 0xffdd8a, transparent: true, opacity: 0 })
  );
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.position.set(0, .035, .85);
  muzzleFlash.name = "bot muzzle flash";
  rifle.add(muzzleFlash);
  group.add(rifle);
  parts.rifle = rifle;

  group.userData.bot = bot;
  group.traverse(object => {
    if (object.isMesh) {
      object.userData.bot = bot;
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  bot.group = group;
  bot.parts = Object.values(parts);
  bot.flashMaterials = [uniform, vest];
  return group;
}

function createWeapon() {
  weapon = new THREE.Group();
  const receiverMat = new THREE.MeshStandardMaterial({ color: 0x4b5349, roughness: .42, metalness: .62 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x41453d, roughness: .78 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x85867d, roughness: .35, metalness: .76 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x394438, roughness: .95 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x4d493d, roughness: .9 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(.16, .15, .43), receiverMat);
  receiver.position.set(.07, -.015, -.17);
  weapon.add(receiver);
  const receiverSide = new THREE.Mesh(new RoundedBoxGeometry(.014, .082, .2, 3, .018), polymer);
  receiverSide.position.set(.153, -.005, -.19);
  weapon.add(receiverSide);
  const ejectionPort = new THREE.Mesh(new RoundedBoxGeometry(.009, .036, .11, 2, .008), metal);
  ejectionPort.position.set(.164, .018, -.17);
  weapon.add(ejectionPort);
  const chargingHandle = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .09, 10), metal);
  chargingHandle.rotation.z = Math.PI / 2;
  chargingHandle.position.set(.17, .075, -.1);
  weapon.add(chargingHandle);
  const fireSelector = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .022, 12), metal);
  fireSelector.rotation.z = Math.PI / 2;
  fireSelector.position.set(.165, -.045, -.005);
  weapon.add(fireSelector);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(.14, .045, .37), metal);
  upper.position.set(.07, .065, -.19);
  weapon.add(upper);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.023, .03, .48, 12), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(.075, .045, -.58);
  weapon.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(.038, .03, .1, 12), polymer);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(.075, .045, -.87);
  weapon.add(muzzle);
  for (let i = 0; i < 4; i++) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(.008, .018, .035), metal);
    port.position.set(.075 + (i % 2 ? .025 : -.025), .045 + (i < 2 ? .025 : -.025), -.87);
    weapon.add(port);
  }
  const stock = new THREE.Mesh(new THREE.BoxGeometry(.13, .12, .31), polymer);
  stock.position.set(.06, -.015, .18);
  weapon.add(stock);
  const magazine = new THREE.Group();
  magazine.name = "magazine";
  magazine.position.set(.075, -.17, -.17);
  magazine.rotation.x = -.12;
  weapon.add(magazine);
  const magBody = new THREE.Mesh(new RoundedBoxGeometry(.105, .24, .15, 3, .022), polymer);
  magazine.add(magBody);
  const magFloor = new THREE.Mesh(new RoundedBoxGeometry(.115, .025, .16, 2, .008), metal);
  magFloor.position.y = -.125;
  magazine.add(magFloor);
  for (let i = -1; i <= 1; i++) {
    const rib = new THREE.Mesh(new RoundedBoxGeometry(.012, .17, .008, 2, .003), receiverMat);
    rib.position.set(i * .031, 0, .077);
    magazine.add(rib);
  }
  weapon.userData.magazine = magazine;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(.09, .17, .11), polymer);
  grip.position.set(.07, -.15, -.005);
  grip.rotation.x = -.23;
  weapon.add(grip);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(.13, .1, .32), polymer);
  handguard.position.set(.07, -.005, -.48);
  weapon.add(handguard);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const vent = new THREE.Mesh(new RoundedBoxGeometry(.012, .026, .026, 2, .005), metal);
      vent.position.set(side * .071, -.005, -.59 + i * .038);
      weapon.add(vent);
    }
    const rail = new THREE.Mesh(new RoundedBoxGeometry(.02, .042, .29, 2, .006), metal);
    rail.position.set(side * .072, .058, -.48);
    weapon.add(rail);
  }
  for (let i = 0; i < 9; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(.15, .017, .018), metal);
    tooth.position.set(.07, .089, -.55 + i * .035);
    weapon.add(tooth);
  }
  const sight = new THREE.Mesh(new THREE.BoxGeometry(.055, .06, .08), metal);
  sight.position.set(.07, .115, -.32);
  weapon.add(sight);
  const optic = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .15), polymer);
  optic.position.set(.07, .15, -.19);
  weapon.add(optic);
  const opticGlass = new THREE.Mesh(new THREE.BoxGeometry(.06, .055, .008), new THREE.MeshBasicMaterial({ color: 0x80b3ac }));
  opticGlass.position.set(.07, .15, -.267);
  weapon.add(opticGlass);

  const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(.085, .35, 4, 8), sleeve);
  forearm.position.set(-.09, -.31, -.34);
  forearm.rotation.x = -.78;
  forearm.rotation.z = .18;
  weapon.add(forearm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(.095, 12, 10), glove);
  hand.position.set(-.01, -.2, -.43);
  hand.scale.set(1, .65, 1.25);
  weapon.add(hand);
  const rearArm = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .4, 4, 8), sleeve);
  rearArm.position.set(.22, -.38, .05);
  rearArm.rotation.z = -.2;
  weapon.add(rearArm);
  const gripHand = new THREE.Mesh(new RoundedBoxGeometry(.12, .12, .1, 3, .035), glove);
  gripHand.position.set(.095, -.12, -.005);
  weapon.add(gripHand);
  const chargingHand = new THREE.Mesh(new RoundedBoxGeometry(.11, .1, .13, 3, .032), glove);
  chargingHand.position.set(.005, -.175, -.42);
  weapon.add(chargingHand);
  const sling = new THREE.Mesh(new THREE.TorusGeometry(.18, .014, 5, 20, Math.PI * 1.25), sleeve);
  sling.position.set(.16, -.08, .08);
  sling.rotation.set(Math.PI / 2, 0, -.42);
  weapon.add(sling);

  muzzleLight = new THREE.PointLight(0xffc477, 0, 5, 2);
  muzzleLight.position.set(.075, .045, -.9);
  weapon.add(muzzleLight);
  const flashGeometry = new THREE.SphereGeometry(.08, 8, 8);
  const flashMesh = new THREE.Mesh(flashGeometry, new THREE.MeshBasicMaterial({ color: 0xffdf93, transparent: true, opacity: 0 }));
  flashMesh.position.copy(muzzleLight.position);
  flashMesh.name = "muzzleFlash";
  weapon.add(flashMesh);

  weapon.scale.setScalar(.65);
  weapon.position.set(.3, -.33, -.82);
  camera.add(weapon);
  receiverMat.emissive.setHex(0x121712);
  receiverMat.emissiveIntensity = .65;
  polymer.emissive.setHex(0x10130f);
  polymer.emissiveIntensity = .6;
  metal.emissive.setHex(0x191c19);
  metal.emissiveIntensity = .35;
  const cameraFill = new THREE.PointLight(0xe5e0ce, 28, 4.5, 2);
  cameraFill.position.set(-.25, .35, .4);
  camera.add(cameraFill);
}

function findSpawn(minDistance = 0, avoid) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = random(21, WORLD - 21);
    const z = random(21, WORLD - 21);
    if (buildingBounds.some(bound => x > bound.minX - .8 && x < bound.maxX + .8 && z > bound.minZ - .8 && z < bound.maxZ + .8)) continue;
    if (scenery.some(tree => Math.hypot(x - tree.x, z - tree.z) < tree.trunkRadius + 1.1)) continue;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDistance) continue;
    return { x, z };
  }
  return { x: WORLD / 2, z: WORLD / 2 };
}

function createPickup(type, position) {
  const pos = position || findSpawn();
  const group = new THREE.Group();
  group.position.set(pos.x, .35, pos.z);
  if (type === "ammo") {
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xb88e42, roughness: .55, metalness: .35 });
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(.44, .3, .32), boxMat);
    caseMesh.castShadow = true;
    group.add(caseMesh);
    for (let i = -1; i <= 1; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(.026, .026, .18, 8), materials.trim);
      round.position.set(i * .105, .19, 0);
      group.add(round);
    }
    group.userData.type = type;
  } else {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(.38, .46, .25), new THREE.MeshStandardMaterial({ color: 0xd7d6bf, roughness: .86 }));
    bag.castShadow = true;
    group.add(bag);
    const crossMaterial = new THREE.MeshStandardMaterial({ color: 0x9d4032, roughness: .68 });
    box("medical cross", [.09, .29, .025], [0, 0, -.14], crossMaterial, group, false);
    box("medical cross", [.23, .09, .025], [0, .015, -.155], crossMaterial, group, false);
    group.userData.type = type;
  }
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(.35, .012, 5, 24),
    new THREE.MeshBasicMaterial({ color: type === "ammo" ? 0xddb862 : 0xe9e4cf, transparent: true, opacity: .68 })
  );
  halo.rotation.x = Math.PI / 2;
  group.add(halo);
  scene.add(group);
  pickups.push({ ...pos, type, active: true, group, halo });
}

function clearMatchEntities() {
  for (const bot of bots) scene.remove(bot.group);
  for (const pickup of pickups) scene.remove(pickup.group);
  bots.length = 0;
  pickups.length = 0;
}

function updateHud() {
  const alive = bots.filter(bot => bot.alive).length + (player.health > 0 ? 1 : 0);
  $("#aliveCount").textContent = String(alive).padStart(2, "0");
  $("#killCount").textContent = String(kills).padStart(2, "0");
  $("#healthText").textContent = Math.ceil(player.health);
  $("#armorText").textContent = Math.ceil(player.armor);
  $("#healthFill").style.width = `${clamp(player.health, 0, 100)}%`;
  $("#armorFill").style.width = `${clamp(player.armor, 0, 100)}%`;
  $("#ammoText").textContent = reloadTimer > 0 ? "··" : String(player.ammo).padStart(2, "0");
  $("#reserveText").textContent = String(player.reserve).padStart(3, "0");
  $("#zoneTimer").textContent = formatTime(zoneTimer);
  $("#zoneStatus").textContent = zoneMode === "wait" ? "SHRINKS IN" : "ZONE SHRINKING";
  $("#zoneCard").classList.toggle("danger", zoneMode === "shrink");
}

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function showNotice(message) {
  $("#notice").textContent = message;
  $("#notice").classList.add("visible");
  noticeTimer = 2;
}

function resetMatch() {
  clearMatchEntities();
  player = { ...findSpawn(), health: 100, armor: 50, ammo: 30, reserve: 120, medkits: 1, pitch: 0 };
  touchMovement.forward = 0;
  touchMovement.sideways = 0;
  touchFiring = false;
  touchFireTimer = 0;
  camera.position.set(player.x, 1.68, player.z);
  camera.rotation.set(0, Math.atan2(player.x - WORLD / 2, player.z - WORLD / 2), 0);
  for (let i = 0; i < BOT_COUNT; i++) {
    const palette = [
      [0x4c5948, 0x47483c, 0x343a30],
      [0x666148, 0x4b4938, 0x4a493d],
      [0x424e4d, 0x3a413c, 0x303938],
      [0x66604b, 0x4f493a, 0x3b4038]
    ][i % 4];
    const bot = {
      ...findSpawn(30, player),
      alive: true,
      health: 100,
      attack: random(.7, 2),
      wander: random(0, 3),
      strafe: Math.random() < .5 ? -1 : 1,
      direction: random(0, Math.PI * 2),
      speed: random(.52, .9),
      phase: random(0, Math.PI * 2),
      shotFlash: 0,
      uniform: palette[0],
      vest: palette[1],
      pants: palette[2],
      helmet: palette[1],
      hitFlash: 0
    };
    const paletteIndex = Math.floor(Math.random() * materials.leaves.length);
    bot.uniform = [0x4e5944, 0x51534a, 0x555b4e][paletteIndex];
    bot.group = createHumanoid(bot);
    bot.group.position.set(bot.x, 0, bot.z);
    scene.add(bot.group);
    bots.push(bot);
  }
  for (let i = 0; i < 12; i++) createPickup(i % 4 === 0 ? "medkit" : "ammo");
  kills = 0;
  zoneRadius = 44.8;
  zoneMode = "wait";
  zoneTimer = 105;
  reloadTimer = 0;
  recoil = 0;
  time = 0;
  updateHud();
  showNotice("LAND, LOOT, SURVIVE");
}

function makeScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xaeb9ac, .0028);
  camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, .08, 260);
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemisphere = new THREE.HemisphereLight(0xd9e8f1, 0x596047, 1.55);
  scene.add(hemisphere);
  const sunDirection = new THREE.Vector3(-.55, .72, -.42).normalize();
  sun = new THREE.DirectionalLight(0xffe6c2, 2.15);
  sun.position.copy(sunDirection).multiplyScalar(110).add(new THREE.Vector3(WORLD / 2, 0, WORLD / 2));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -66;
  sun.shadow.camera.right = 66;
  sun.shadow.camera.top = 66;
  sun.shadow.camera.bottom = -66;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.normalBias = .035;
  sun.shadow.bias = -.00012;
  sun.target.position.set(WORLD / 2, 0, WORLD / 2);
  scene.add(sun, sun.target);
  sky = new Sky();
  sky.scale.setScalar(450000);
  sky.material.uniforms.turbidity.value = 5;
  sky.material.uniforms.rayleigh.value = 1.6;
  sky.material.uniforms.mieCoefficient.value = .004;
  sky.material.uniforms.mieDirectionalG.value = .79;
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);
  makeMaterials();
  createWorld();
  createWeapon();
  scene.add(camera);
}

function makeMinimap() {
  const size = minimap.width;
  map.clearRect(0, 0, size, size);
  map.fillStyle = "#283b31";
  map.fillRect(0, 0, size, size);
  const unit = size / WORLD;
  map.fillStyle = "#786c50";
  for (const bound of buildingBounds) map.fillRect(bound.minX * unit, bound.minZ * unit, (bound.maxX - bound.minX) * unit, (bound.maxZ - bound.minZ) * unit);
  map.strokeStyle = zoneMode === "shrink" ? "#ff7965" : "#c9ff3b";
  map.lineWidth = 2;
  map.beginPath();
  map.arc(size / 2, size / 2, zoneRadius / WORLD * size, 0, Math.PI * 2);
  map.stroke();
  for (const tree of scenery) {
    map.fillStyle = "#658058";
    map.fillRect(tree.x / WORLD * size - 1, tree.z / WORLD * size - 1, 2, 2);
  }
  for (const pickup of pickups) {
    if (!pickup.active) continue;
    map.fillStyle = pickup.type === "medkit" ? "#ece5d2" : "#d7b65d";
    map.fillRect(pickup.x / WORLD * size - 1.5, pickup.z / WORLD * size - 1.5, 3, 3);
  }
  for (const bot of bots) {
    if (!bot.alive) continue;
    map.fillStyle = "#ff785f";
    map.beginPath();
    map.arc(bot.x / WORLD * size, bot.z / WORLD * size, 2.5, 0, Math.PI * 2);
    map.fill();
  }
  map.save();
  map.translate(player.x / WORLD * size, player.z / WORLD * size);
  map.rotate(-camera.rotation.y);
  map.fillStyle = "#c9ff3b";
  map.beginPath();
  map.moveTo(5, 0);
  map.lineTo(-3, -3);
  map.lineTo(-3, 3);
  map.closePath();
  map.fill();
  map.restore();
}

function intersectsBuilding(x, z, radius) {
  return buildingBounds.some(bound =>
    x + radius > bound.minX && x - radius < bound.maxX &&
    z + radius > bound.minZ && z - radius < bound.maxZ
  );
}

function intersectsTree(x, z, radius) {
  return scenery.some(tree => Math.hypot(x - tree.x, z - tree.z) < tree.trunkRadius + radius);
}

function movePlayer(dt) {
  let forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchMovement.forward;
  let sideways = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + touchMovement.sideways;
  forward = clamp(forward, -1, 1);
  sideways = clamp(sideways, -1, 1);
  const moving = forward !== 0 || sideways !== 0;
  if (!moving) {
    swayX *= Math.max(0, 1 - dt * 5);
    swayY *= Math.max(0, 1 - dt * 5);
    return;
  }
  const length = Math.hypot(forward, sideways);
  forward /= length;
  sideways /= length;
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = sprint ? 7.2 : 4.8;
  camera.getWorldDirection(movementForward);
  movementForward.y = 0;
  movementForward.normalize();
  movementRight.crossVectors(movementForward, camera.up).normalize();
  const dx = (movementForward.x * forward + movementRight.x * sideways) * speed * dt;
  const dz = (movementForward.z * forward + movementRight.z * sideways) * speed * dt;
  const nextX = clamp(player.x + dx, 1, WORLD - 1);
  const nextZ = clamp(player.z + dz, 1, WORLD - 1);
  if (!intersectsBuilding(nextX, player.z, .29) && !intersectsTree(nextX, player.z, .29)) player.x = nextX;
  if (!intersectsBuilding(player.x, nextZ, .29) && !intersectsTree(player.x, nextZ, .29)) player.z = nextZ;
  walkPhase += dt * (sprint ? 13 : 9);
  swayX += sideways * dt * (sprint ? 1.4 : 1);
  swayY += dt * (sprint ? 1.5 : 1);
}

function fire() {
  if (!running || paused || player.health <= 0 || reloadTimer > 0) return;
  if (player.ammo <= 0) {
    showNotice("PRESS R TO RELOAD");
    return;
  }
  player.ammo--;
  recoil = Math.min(.11, recoil + .038);
  muzzleLight.intensity = 13;
  const flash = weapon.getObjectByName("muzzleFlash");
  flash.material.opacity = 1;
  flash.scale.setScalar(random(.75, 1.4));
  setTimeout(() => { if (flash) flash.material.opacity = 0; }, 65);
  setTimeout(() => { muzzleLight.intensity = 0; }, 85);
  const centerReticle = $(".center-reticle");
  centerReticle.classList.add("firing");
  setTimeout(() => centerReticle.classList.remove("firing"), 75);

  raycaster.setFromCamera(aimPoint, camera);
  const targets = [...blockers, ...bots.filter(bot => bot.alive).map(bot => bot.group)];
  const intersections = raycaster.intersectObjects(targets, true);
  const hit = intersections.find(item => item.object.userData.bot || blockers.includes(item.object));
  if (hit?.object.userData.bot) {
    const target = hit.object.userData.bot;
    target.health -= 34;
    target.hitFlash = .15;
    const marker = $("#hitMarker");
    marker.classList.remove("visible");
    void marker.offsetWidth;
    marker.classList.add("visible");
    if (target.health <= 0) {
      target.alive = false;
      scene.remove(target.group);
      kills++;
      showNotice("TARGET ELIMINATED");
      if (Math.random() < .75) createPickup("ammo", { x: target.x, z: target.z });
      if (bots.every(bot => !bot.alive)) finish(true);
    }
  }
  updateHud();
}

function reload() {
  if (!running || paused || reloadTimer > 0 || player.ammo >= 30 || player.reserve <= 0) return;
  reloadTimer = 1.5;
  showNotice("RELOADING");
  updateHud();
}

function useMedkit() {
  if (player.medkits < 1) {
    showNotice("NO MEDKITS");
    return;
  }
  if (player.health >= 100) {
    showNotice("HEALTH ALREADY FULL");
    return;
  }
  player.medkits--;
  player.health = Math.min(100, player.health + 45);
  showNotice("MEDKIT USED  +45");
  updateHud();
}

function hurt(amount) {
  const absorbed = Math.min(player.armor, amount * .65);
  player.armor -= absorbed;
  player.health -= amount - absorbed;
  damageTimer = .25;
  $("#damageVignette").classList.add("active");
  updateHud();
  if (player.health <= 0) finish(false);
}

function finish(won) {
  if (!running) return;
  running = false;
  touchFiring = false;
  $("#touchControls").classList.remove("active");
  document.exitPointerLock?.();
  $("#resultTitle").textContent = won ? "VICTORY" : "ELIMINATED";
  $("#resultTitle").style.color = won ? "var(--acid)" : "#ff7864";
  $("#resultMessage").textContent = won ? "You are the last one standing." : "The island claimed another one.";
  $("#finalKills").textContent = String(kills).padStart(2, "0");
  $("#finalPlace").textContent = won ? "#1" : `#${bots.filter(bot => bot.alive).length + 1}`;
  $("#endScreen").classList.remove("hidden");
}

function updateZone(dt) {
  zoneTimer -= dt;
  if (zoneTimer <= 0) {
    if (zoneMode === "wait") {
      zoneMode = "shrink";
      zoneTimer = 48;
      showNotice("THE SAFE ZONE IS CLOSING");
    } else {
      zoneRadius = Math.max(12.8, zoneRadius - 5.4);
      if (zoneRadius <= 12.8) {
        zoneMode = "wait";
        zoneTimer = 24;
      } else zoneTimer = 48;
    }
  }
  zoneRing.scale.setScalar(zoneRadius);
  if (Math.hypot(player.x - WORLD / 2, player.z - WORLD / 2) > zoneRadius) {
    hurt(9 * dt);
    if (Math.random() < dt * 1.8) showNotice("OUTSIDE SAFE ZONE");
  }
}

function botCanSeePlayer(bot, direction, distance) {
  raycaster.set(new THREE.Vector3(bot.x, 1.25, bot.z), direction);
  raycaster.far = distance;
  const hit = raycaster.intersectObjects(blockers, false)[0];
  return !hit || hit.distance >= distance - .35;
}

function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;
    bot.attack -= dt;
    bot.wander -= dt;
    bot.hitFlash = Math.max(0, bot.hitFlash - dt);
    const dx = player.x - bot.x;
    const dz = player.z - bot.z;
    const distance = Math.hypot(dx, dz);
    const direction = new THREE.Vector3(dx / Math.max(distance, .001), 0, dz / Math.max(distance, .001));
    const visible = distance < 34 && botCanSeePlayer(bot, direction, distance);
    let moving = false;
    if (visible) {
      bot.group.rotation.y = Math.atan2(direction.x, direction.z);
      if (distance > 11) {
        const pace = distance > 25 ? bot.speed : bot.speed * .6;
        const nx = bot.x + direction.x * pace * dt;
        const nz = bot.z + direction.z * pace * dt;
        if (!intersectsBuilding(nx, bot.z, .31) && !intersectsTree(nx, bot.z, .31)) bot.x = nx;
        if (!intersectsBuilding(bot.x, nz, .31) && !intersectsTree(bot.x, nz, .31)) bot.z = nz;
        moving = true;
      } else {
        const nx = bot.x + direction.z * bot.strafe * .43 * dt;
        const nz = bot.z - direction.x * bot.strafe * .43 * dt;
        if (!intersectsBuilding(nx, nz, .31) && !intersectsTree(nx, nz, .31)) {
          bot.x = nx;
          bot.z = nz;
          moving = true;
        }
        if (bot.wander <= 0) {
          bot.strafe *= -1;
          bot.wander = random(.8, 2.1);
        }
      }
      if (distance < 25 && bot.attack <= 0) {
        if (Math.random() > .3) {
          hurt(random(4, 8));
          bot.shotFlash = .085;
        }
        bot.attack = random(1.2, 2.2);
      }
    } else {
      if (bot.wander <= 0) {
        bot.direction += random(-1.6, 1.6);
        bot.wander = random(1.6, 3.4);
      }
      const nx = bot.x + Math.sin(bot.direction) * bot.speed * .35 * dt;
      const nz = bot.z + Math.cos(bot.direction) * bot.speed * .35 * dt;
      if (intersectsBuilding(nx, nz, .31) || intersectsTree(nx, nz, .31)) {
        bot.direction += Math.PI * random(.5, 1.5);
        bot.wander = .1;
      } else {
        bot.x = nx;
        bot.z = nz;
        bot.group.rotation.y = bot.direction;
        moving = true;
      }
    }
    bot.phase += dt * (moving ? 9 : 2);
    bot.shotFlash = Math.max(0, bot.shotFlash - dt);
    const hitGlow = bot.hitFlash > 0 ? 0x633a20 : 0x000000;
    for (const material of bot.flashMaterials) material.emissive.setHex(hitGlow);
    bot.group.position.set(bot.x, 0, bot.z);
    for (const part of bot.parts) {
      if (part.name === "leftLeg") part.rotation.x = Math.sin(bot.phase) * (moving ? .39 : .012);
      if (part.name === "rightLeg") part.rotation.x = Math.sin(bot.phase + Math.PI) * (moving ? .39 : .012);
      if (part.name === "leftCalf") part.rotation.x = Math.max(0, Math.sin(bot.phase + .5)) * (moving ? .48 : 0);
      if (part.name === "rightCalf") part.rotation.x = Math.max(0, Math.sin(bot.phase + Math.PI + .5)) * (moving ? .48 : 0);
      if (part.name === "leftArm" || part.name === "rightArm") {
        const basePose = part.userData.walkPose;
        part.rotation.x = basePose.x + Math.sin(bot.phase + (part.name === "leftArm" ? Math.PI : 0)) * (moving ? .07 : .01);
        part.rotation.z = basePose.z;
      }
      if (part.name === "rifle") part.position.z = .34 + bot.shotFlash * .42;
    }
    const botFlash = bot.group.getObjectByName("bot muzzle flash");
    if (botFlash) botFlash.material.opacity = bot.shotFlash > 0 ? .92 : 0;
  }
}

function updatePickups(dt) {
  for (const pickup of pickups) {
    if (!pickup.active) continue;
    pickup.group.rotation.y += dt * .45;
    pickup.halo.material.opacity = .48 + Math.sin(time * 2 + pickup.x) * .15;
    if (Math.hypot(player.x - pickup.x, player.z - pickup.z) > 1.25) continue;
    if (pickup.type === "ammo") {
      player.reserve = Math.min(240, player.reserve + 30);
      showNotice("AMMO PICKED UP  +30");
    } else {
      player.medkits = Math.min(3, player.medkits + 1);
      showNotice("MEDKIT PICKED UP  ·  PRESS E");
    }
    pickup.active = false;
    scene.remove(pickup.group);
    updateHud();
  }
}

function updateWeapon(dt, moving) {
  recoil = Math.max(0, recoil - dt * .15);
  const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const bob = moving ? Math.sin(walkPhase) * (sprint ? .035 : .022) : 0;
  const sideBob = moving ? Math.cos(walkPhase * .5) * .012 : 0;
  weapon.position.x = .37 + sideBob + swayX * .008;
  weapon.position.y = -.34 + bob - (sprint && moving ? .07 : 0);
  weapon.position.z = -.57 + recoil * .72;
  weapon.rotation.x = -.025 + recoil * 1.15 + bob * .42;
  weapon.rotation.y = sideBob * 1.4;
  const reloadProgress = reloadTimer > 0 ? 1 - reloadTimer / 1.5 : 0;
  const reloadDip = reloadTimer > 0 ? Math.sin(clamp(reloadProgress, 0, 1) * Math.PI) : 0;
  const magazine = weapon.userData.magazine;
  magazine.position.y = -.17 - reloadDip * .24;
  magazine.rotation.x = -.12 - reloadDip * .24;
  weapon.rotation.z = reloadDip * .045;
  camera.position.set(player.x, 1.68 + bob * .28, player.z);
  camera.rotation.x = clamp(player.pitch + recoil * .8, -1.35, 1.35);
  swayX *= Math.max(0, 1 - dt * 4);
  swayY *= Math.max(0, 1 - dt * 4);
}

function animate(dt) {
  time += dt;
  if (touchFiring) {
    touchFireTimer -= dt;
    if (touchFireTimer <= 0) {
      fire();
      touchFireTimer = .14;
      if (player.ammo <= 0) touchFiring = false;
    }
  }
  const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD") ||
    keys.has("ArrowUp") || keys.has("ArrowDown") || keys.has("ArrowLeft") || keys.has("ArrowRight") ||
    Math.abs(touchMovement.forward) > .05 || Math.abs(touchMovement.sideways) > .05;
  movePlayer(dt);
  updateBots(dt);
  updatePickups(dt);
  updateZone(dt);
  updateWeapon(dt, moving);
  if (reloadTimer > 0) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) {
      const loaded = Math.min(30 - player.ammo, player.reserve);
      player.ammo += loaded;
      player.reserve -= loaded;
      reloadTimer = 0;
      showNotice("RELOADED");
      updateHud();
    }
  }
  if (noticeTimer > 0) {
    noticeTimer -= dt;
    if (noticeTimer <= 0) $("#notice").classList.remove("visible");
  }
  if (damageTimer > 0) {
    damageTimer -= dt;
    if (damageTimer <= 0) $("#damageVignette").classList.remove("active");
  }
  if (time - lastHudTick > 1) {
    lastHudTick = time;
    updateHud();
  }
  makeMinimap();
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), .05);
  if (running && !paused) animate(dt);
  else {
    time += dt;
    camera.position.set(player.x, 1.68, player.z);
    makeMinimap();
  }
  renderer.render(scene, camera);
}

function startMatch() {
  resetMatch();
  running = true;
  paused = false;
  $("#startScreen").classList.add("hidden");
  $("#endScreen").classList.add("hidden");
  $("#touchControls").classList.toggle("active", touchMode);
  if (touchMode) {
    fallbackInput = true;
    showNotice("MOVE · DRAG RIGHT SIDE TO AIM · HOLD FIRE");
  } else requestCapture();
}

function requestCapture() {
  try {
    const request = canvas.requestPointerLock();
    request?.catch(() => {
      fallbackInput = true;
      showNotice("DRAG TO LOOK · CLICK TO FIRE");
    });
  } catch {
    fallbackInput = true;
    showNotice("DRAG TO LOOK · CLICK TO FIRE");
  }
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
}

function boot() {
  if (!window.WebGLRenderingContext) {
    showNotice("WEBGL IS REQUIRED TO PLAY");
    return;
  }
  makeScene();
  resetMatch();
  $("#zoneTimer").textContent = formatTime(zoneTimer);
  $("#aliveCount").textContent = String(BOT_COUNT + 1);
  window.addEventListener("resize", resize);
  const movePad = $("#movePad");
  const moveStick = $("#moveStick");
  const fireButton = $("#fireButton");
  const updateTouchMovement = event => {
    const bounds = movePad.getBoundingClientRect();
    const radius = bounds.width / 2 - 25;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.min(Math.hypot(dx, dy), radius);
    const angle = Math.atan2(dy, dx);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    touchMovement.sideways = x / radius;
    touchMovement.forward = -y / radius;
    moveStick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };
  movePad.addEventListener("pointerdown", event => {
    if (!running || paused || event.pointerType !== "touch") return;
    event.preventDefault();
    touchMovePointer = event.pointerId;
    movePad.setPointerCapture(event.pointerId);
    updateTouchMovement(event);
  });
  movePad.addEventListener("pointermove", event => {
    if (event.pointerId === touchMovePointer) updateTouchMovement(event);
  });
  const releaseMove = event => {
    if (event.pointerId !== touchMovePointer) return;
    touchMovePointer = null;
    touchMovement.forward = 0;
    touchMovement.sideways = 0;
    moveStick.style.transform = "translate(-50%, -50%)";
  };
  movePad.addEventListener("pointerup", releaseMove);
  movePad.addEventListener("pointercancel", releaseMove);
  movePad.addEventListener("lostpointercapture", releaseMove);
  fireButton.addEventListener("pointerdown", event => {
    if (!running || paused || event.pointerType !== "touch") return;
    event.preventDefault();
    touchFirePointer = event.pointerId;
    fireButton.setPointerCapture(event.pointerId);
    touchFiring = true;
    touchFireTimer = .14;
    fire();
  });
  const releaseFire = event => {
    if (event.pointerId !== touchFirePointer) return;
    touchFirePointer = null;
    touchFiring = false;
  };
  fireButton.addEventListener("pointerup", releaseFire);
  fireButton.addEventListener("pointercancel", releaseFire);
  fireButton.addEventListener("lostpointercapture", releaseFire);
  $("#reloadButton").addEventListener("click", reload);
  $("#medkitButton").addEventListener("click", useMedkit);
  canvas.addEventListener("pointerdown", event => {
    if (!running || paused || event.pointerType !== "touch" || event.clientX < innerWidth / 2) return;
    event.preventDefault();
    touchLookPointer = event.pointerId;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (event.pointerId !== touchLookPointer) return;
    const dx = event.clientX - lastMouseX;
    const dy = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    camera.rotation.y -= dx * .00215;
    player.pitch = clamp(player.pitch - dy * .00185, -1.35, 1.35);
    camera.rotation.x = player.pitch;
  });
  const releaseLook = event => {
    if (event.pointerId === touchLookPointer) touchLookPointer = null;
  };
  canvas.addEventListener("pointerup", releaseLook);
  canvas.addEventListener("pointercancel", releaseLook);
  document.addEventListener("keydown", event => {
    keys.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyR") reload();
    if (event.code === "KeyE" && running && !paused) useMedkit();
    if (event.code === "Escape" && running && document.pointerLockElement !== canvas) {
      paused = true;
      showNotice("PAUSED · CLICK TO RESUME");
    }
  });
  document.addEventListener("keyup", event => keys.delete(event.code));
  document.addEventListener("mousemove", event => {
    if (!running || paused) return;
    const captured = document.pointerLockElement === canvas;
    if (!captured && (!fallbackInput || !dragging)) return;
    const dx = captured ? event.movementX : event.clientX - lastMouseX;
    const dy = captured ? event.movementY : event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    camera.rotation.y -= dx * .00215;
    player.pitch = clamp(player.pitch - dy * .00185, -1.35, 1.35);
    camera.rotation.x = player.pitch;
    swayX += dx * .00025;
    swayY += dy * .0002;
  });
  document.addEventListener("pointerlockchange", () => {
    const captured = document.pointerLockElement === canvas;
    if (running && pointerLockActive && !captured) {
      paused = true;
      showNotice("PAUSED · CLICK TO RESUME");
    }
    pointerLockActive = captured;
  });
  canvas.addEventListener("click", () => {
    if (!running) return;
    if (paused) {
      requestCapture();
      paused = false;
      clock.getDelta();
      return;
    }
    if (document.pointerLockElement === canvas || fallbackInput) fire();
    else requestCapture();
  });
  canvas.addEventListener("mousedown", event => {
    if (!running || paused || document.pointerLockElement === canvas || !fallbackInput) return;
    dragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  $("#startButton").addEventListener("click", startMatch);
  $("#playAgainButton").addEventListener("click", startMatch);
  frame();
}

try {
  boot();
} catch (error) {
  console.error("Unable to initialize Last Drop:", error);
  $("#notice").textContent = `3D STARTUP ERROR · ${error.message}`;
  $("#notice").classList.add("visible");
}
