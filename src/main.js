/*****************************************************
 * main.js (Simplified + Draco)
 * Demonstrates:
 *   - Basic Three.js + Cannon.js scene
 *   - Ground plane
 *   - A single user car loaded from a Draco-compressed GLB
 *   - Minimal joystick for forward/back/left/right control
 *****************************************************/

// ========== Imports ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========
let scene, camera, renderer;
let physicsWorld;
let carMesh, carBody;
let joystickBase, joystickKnob;
let joystickActive = false;
let joystickMaxDistance = 0;
let joystickX = 0, joystickY = 0;

// Joystick-based inputs
let accelerateInput = false;
let decelerateInput = false;
let moveLeft = false;
let moveRight = false;

// Simple speed logic
const baseVelocity = 5;
const minVelocity = 1;
const maxVelocity = 20;

let previousTime = 0;
let animationId;

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  loadCarModelWithDraco(); // Load a Draco-compressed .glb

  initJoystick();
  window.addEventListener("resize", onWindowResize, false);

  previousTime = Date.now();
  animate();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // sky-blue

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );
  camera.position.set(0, 5, -15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, -10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 512;
  dirLight.shadow.mapSize.height = 512;
  scene.add(dirLight);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========== PHYSICS ==========
function initPhysics() {
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physicsWorld.solver.iterations = 10;

  // Ground plane (infinite)
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // Rotate so plane is horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT ==========
function initEnvironment() {
  // Simple visual ground
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ========== LOAD DRACO-COMPRESSED GLB ==========

function loadCarModelWithDraco() {
  // 1) Create GLTFLoader
  const gltfLoader = new GLTFLoader();

  // 2) Create DRACOLoader and set the decoder path
  const dracoLoader = new DRACOLoader();
  // Make sure you host the Draco decoder files at "/draco/"
  // (draco_decoder.js, draco_wasm_wrapper.js, etc.)
  dracoLoader.setDecoderPath("/draco/");
  // Then assign it to our GLTFLoader
  gltfLoader.setDRACOLoader(dracoLoader);

  // 3) Load your Draco-compressed .glb
  gltfLoader.load(
    "/car1.glb", // <--- path to your compressed GLB
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Create Cannon body with a simple box shape
      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
      // Place above ground
      carBody = new CANNON.Body({
        mass: 100,
        shape: carShape,
        position: new CANNON.Vec3(0, 1.1, 0),
        linearDamping: 0.3,
        angularDamping: 0.6,
      });
      carBody.fixedRotation = true;
      physicsWorld.addBody(carBody);

      carMesh.position.set(0, 1.1, 0);
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

// Fallback if Draco fails
function createFallbackCar() {
  const boxGeom = new THREE.BoxGeometry(2, 1, 4);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  carMesh = new THREE.Mesh(boxGeom, boxMat);
  carMesh.castShadow = true;
  scene.add(carMesh);

  const halfExtents = new CANNON.Vec3(1, 0.5, 2);
  carBody = new CANNON.Body({
    mass: 100,
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(0, 1.1, 0),
    linearDamping: 0.3,
    angularDamping: 0.6,
  });
  carBody.fixedRotation = true;
  physicsWorld.addBody(carBody);

  carMesh.position.set(0, 1.1, 0);
}

// ========== JOYSTICK SETUP (Minimal) ==========
function initJoystick() {
  joystickBase = document.getElementById("joystick-base");
  joystickKnob = document.getElementById("joystick-knob");
  if (!joystickBase || !joystickKnob) return;

  joystickMaxDistance = joystickBase.offsetWidth / 2;

  joystickBase.removeEventListener("touchstart", onJoystickStart);
  joystickBase.removeEventListener("touchmove", onJoystickMove);
  joystickBase.removeEventListener("touchend", onJoystickEnd);
  joystickBase.removeEventListener("mousedown", onJoystickStart);
  document.removeEventListener("mousemove", onJoystickMove);
  document.removeEventListener("mouseup", onJoystickEnd);

  joystickBase.addEventListener("touchstart", onJoystickStart, { passive: false });
  joystickBase.addEventListener("touchmove", onJoystickMove, { passive: false });
  joystickBase.addEventListener("touchend", onJoystickEnd, { passive: false });
  joystickBase.addEventListener("mousedown", onJoystickStart, { passive: false });
  document.addEventListener("mousemove", onJoystickMove, { passive: false });
  document.addEventListener("mouseup", onJoystickEnd, { passive: false });
}

function onJoystickStart(e) {
  e.preventDefault();
  joystickActive = true;
  joystickKnob.classList.add("active");
  updateJoystick(e);
}

function onJoystickMove(e) {
  if (!joystickActive) return;
  e.preventDefault();
  updateJoystick(e);
}

function onJoystickEnd(e) {
  if (!joystickActive) return;
  e.preventDefault();
  joystickActive = false;
  joystickKnob.classList.remove("active");

  joystickKnob.style.transition = "transform 0.3s ease";
  joystickKnob.style.transform = "translate(0,0)";
  setTimeout(() => {
    joystickKnob.style.transition = "transform 0.1s ease";
    joystickX = 0;
    joystickY = 0;
  }, 300);

  // Reset
  accelerateInput = false;
  decelerateInput = false;
  moveLeft = false;
  moveRight = false;
}

function updateJoystick(e) {
  const rect = joystickBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const x = clientX - rect.left - rect.width / 2;
  const y = clientY - rect.top - rect.height / 2;
  const dist = Math.sqrt(x * x + y * y);
  const angle = Math.atan2(y, x);
  const clampedDist = Math.min(dist, joystickMaxDistance);

  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;
  joystickY = (clampedDist * Math.sin(angle)) / joystickMaxDistance;

  // Move the knob
  joystickKnob.style.transform = `translate(${
    joystickX * joystickMaxDistance * 0.6
  }px, ${joystickY * joystickMaxDistance * 0.6}px)`;

  const deadZone = 0.2;
  // Pull down => +Z forward, up => -Z
  accelerateInput = joystickY > deadZone;
  decelerateInput = joystickY < -deadZone;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  // Step physics
  physicsWorld.step(1 / 60, dt, 3);

  updateLogic(dt);
  renderer.render(scene, camera);
}

function updateLogic(dt) {
  if (!carBody) return;

  // We'll store velocity in local vars
  let velX = carBody.velocity.x;
  let velZ = carBody.velocity.z;

  // Forward/back
  if (accelerateInput) {
    velZ = Math.min(velZ + 10 * dt, maxVelocity);
  } else if (decelerateInput) {
    velZ = Math.max(velZ - 10 * dt, minVelocity);
  } else {
    // approach baseVelocity
    if (velZ > baseVelocity) {
      velZ -= 2 * dt;
    } else if (velZ < baseVelocity) {
      velZ += 2 * dt;
    }
  }

  // Side movement
  if (moveLeft) {
    velX = -5;
  } else if (moveRight) {
    velX = 5;
  } else {
    velX *= 0.9;
    if (Math.abs(velX) < 0.05) velX = 0;
  }

  carBody.velocity.x = velX;
  carBody.velocity.z = velZ;

  // Sync Three mesh
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  // Basic chase camera
  const desiredPos = new THREE.Vector3(
    carBody.position.x,
    5,
    carBody.position.z - 15
  );
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(carBody.position.x, carBody.position.y, carBody.position.z);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
