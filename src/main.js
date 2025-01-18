/*****************************************************
 * main.js (Simplified + Draco, Real Car Controls)
 * Demonstrates:
 *   - Basic Three.js + Cannon.js scene
 *   - Ground plane
 *   - A single user car loaded from a Draco-compressed GLB
 *   - Minimal joystick for forward/back/left/right control
 *   - Start Screen hidden after pressing "Play"
 *   - "Real car" controls (accelerate + brake => potential reverse)
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
let joystickX = 0,
  joystickY = 0;

let accelerateInput = false;
let brakeInput = false; // "decelerate" -> now a brake that can lead to reverse
let moveLeft = false;
let moveRight = false;

// Some basic "car-like" constraints
// Real cars can definitely exceed 20 m/s, but let's keep it smaller for demo
const MAX_FORWARD_SPEED = 20; // m/s ~ 72 km/h
const MAX_REVERSE_SPEED = 5;  // m/s ~ 18 km/h

// We define an "engine power" for forward acceleration, and a "brake power" for deceleration/reverse
const ENGINE_FORCE = 10;
const BRAKE_FORCE = 8;

// This base speed is where the car tries to come to rest if no inputs
// (like rolling friction)
let idleSpeed = 0; 
// If you prefer a small rolling speed, you could set idleSpeed = 2 or so.

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

  // Hook up the "Start" button to hide the start screen
  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  if (playButton) {
    playButton.addEventListener("click", () => {
      if (startScreen) {
        startScreen.style.display = "none";
      }
    });
  }

  previousTime = Date.now();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // sky-blue

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

// ========== PHYSICS SETUP ==========
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
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ========== LOAD DRACO-COMPRESSED GLB ==========
function loadCarModelWithDraco() {
  const gltfLoader = new GLTFLoader();

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.load(
    "/car1.glb",
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

      // Simple box shape for the body
      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
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

// ========== JOYSTICK SETUP (Real-Car Approach) ==========
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

  // Reset inputs
  accelerateInput = false;
  brakeInput = false;
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
  // For "car" logic:
  // - Pull joystick down => accelerate
  // - Pull joystick up => brake (and possibly reverse)
  accelerateInput = joystickY > deadZone;
  brakeInput = joystickY < -deadZone;
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

  updateCarLogic(dt);
  renderer.render(scene, camera);
}

// ========== CAR LOGIC (Real-Car) ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // Current velocity in world coords
  let vx = carBody.velocity.x;
  let vz = carBody.velocity.z;

  // The car’s forward direction is +Z in our example.
  // We'll consider the "forward speed" as the projection of (vx, vz) onto +Z:
  // i.e. speedAlongZ = (vx, vz) dot (0,1) but we only have x, z => dot with (0,1)? 
  // Actually we can do the magnitude approach, or just treat z as the main speed.
  // We'll do a simpler approach: "speed" ~ vz, if the car is facing +Z
  // Because we haven't introduced car rotation about Y for actual heading, we can keep it simple.

  // "speed" in m/s along Z
  let speed = vz; 

  // 1) ACCELERATE
  if (accelerateInput) {
    // If we are going forward or slightly negative, push us forward
    speed += ENGINE_FORCE * dt;
    if (speed > MAX_FORWARD_SPEED) speed = MAX_FORWARD_SPEED;
  }

  // 2) BRAKE / REVERSE
  else if (brakeInput) {
    // If speed > 0, brake
    // If speed < 0, we are reversing already
    speed -= BRAKE_FORCE * dt; 
    if (speed < -MAX_REVERSE_SPEED) speed = -MAX_REVERSE_SPEED;
  }

  // 3) If no input, gently approach idleSpeed
  else {
    // Approach idleSpeed
    const diff = speed - idleSpeed;
    const brakeFactor = 2; 
    // If diff > 0, slow down
    if (diff > 0) {
      speed -= brakeFactor * dt;
      if (speed < idleSpeed) speed = idleSpeed;
    }
    // if diff < 0, speed up to idle
    else if (diff < 0) {
      speed += brakeFactor * dt;
      if (speed > idleSpeed) speed = idleSpeed;
    }
  }

  // STEERING
  let sideSpeed = vx;
  if (moveLeft) {
    sideSpeed = -5;
  } else if (moveRight) {
    sideSpeed = 5;
  } else {
    // Dampen side velocity
    sideSpeed *= 0.9;
    if (Math.abs(sideSpeed) < 0.05) {
      sideSpeed = 0;
    }
  }

  // Apply updated velocities
  carBody.velocity.x = sideSpeed;
  carBody.velocity.z = speed;

  // Sync Three mesh
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  updateCamera();
}

function updateCamera() {
  if (!carBody) return;
  const desiredPos = new THREE.Vector3(
    carBody.position.x,
    5,
    carBody.position.z - 15
  );
  camera.position.lerp(desiredPos, 0.1);
  camera.lookAt(carBody.position.x, carBody.position.y, carBody.position.z);
}

// ========== EXPORTS OR STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
