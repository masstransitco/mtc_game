/*****************************************************
 * main.js (Refined Controls + Obstacle Collisions)
 *
 * 1) Car movement:
 *    - Steering via joystick (left/right).
 *    - Two on-screen buttons for Accelerate and Brake/Reverse.
 *    - Real-car style acceleration + braking logic.
 *
 * 2) Obstacles:
 *    - Placed on the road to test collisions.
 *    - Display "Collision!" overlay + console log on impact.
 *
 * 3) Draco-compressed car model loaded with GLTF + DRACOLoader.
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
let joystickX = 0; // Only used for steering
// We removed joystickY usage for forward/back

// Buttons for accelerate/brake
let accelerateButton, brakeButton;
let accelerateInput = false;
let brakeInput = false;
let moveLeft = false;
let moveRight = false;

// Basic car constraints
const MAX_FORWARD_SPEED = 20; // m/s (~72 km/h)
const MAX_REVERSE_SPEED = 5;  // m/s (~18 km/h)
const ENGINE_FORCE = 10;
const BRAKE_FORCE = 8;
const idleSpeed = 0;  // if you want slow rolling, set > 0

let previousTime = 0;
let animationId;

// Obstacles
let obstacles = [];
let obstacleBodies = [];
let obstacleSize = 2; // Each obstacle is 2x2 in XZ
let collisionIndicator; // For on-screen "Collision!" message

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles(); // Create a few obstacles
  loadCarModelWithDraco();

  initJoystick();
  initButtons();
  window.addEventListener("resize", onWindowResize, false);

  // Hide the "Start" screen after pressing play
  const startScreen = document.getElementById("start-screen");
  const playButton = document.getElementById("play-button");
  if (playButton) {
    playButton.addEventListener("click", () => {
      if (startScreen) {
        startScreen.style.display = "none";
      }
    });
  }

  // We'll show collisions in overlay
  collisionIndicator = document.getElementById("collisionIndicator");

  previousTime = Date.now();
  animate();
}

// ========== SCENE SETUP ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

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

  // Ground plane
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // Rotate so plane is horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT (Road) ==========
function initEnvironment() {
  // Simple large plane in Three.js
  const groundSize = 200;
  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// ========== OBSTACLES ==========
function spawnObstacles() {
  // We'll place a few box obstacles along the road
  // Hardcode or randomize positions
  const obstaclePositions = [
    { x: 1, z: 20 },
    { x: -2, z: 35 },
    { x: 2, z: 50 }
  ];

  for (let pos of obstaclePositions) {
    // THREE mesh
    const geo = new THREE.BoxGeometry(obstacleSize, obstacleSize, obstacleSize);
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const boxMesh = new THREE.Mesh(geo, mat);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;

    // Place above ground so it doesn't intersect
    boxMesh.position.set(pos.x, obstacleSize / 2, pos.z);
    scene.add(boxMesh);

    // Cannon body
    const halfSize = obstacleSize / 2;
    const shape = new CANNON.Box(new CANNON.Vec3(halfSize, halfSize, halfSize));
    const body = new CANNON.Body({
      mass: 0, // static obstacle
      shape: shape,
      position: new CANNON.Vec3(pos.x, obstacleSize / 2, pos.z)
    });
    physicsWorld.addBody(body);

    // Keep reference
    obstacles.push(boxMesh);
    obstacleBodies.push(body);
  }
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

      const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
      carBody = new CANNON.Body({
        mass: 100,
        shape: carShape,
        position: new CANNON.Vec3(0, 1.1, 0),
        linearDamping: 0.3,
        angularDamping: 0.6,
      });
      carBody.fixedRotation = true;

      // Add collision event to detect obstacles
      carBody.addEventListener("collide", (evt) => {
        // If collided with an obstacle
        // (In a more advanced approach, we might check evt.body userData)
        handleCollision(evt);
      });

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
  carBody.addEventListener("collide", (evt) => {
    handleCollision(evt);
  });
  physicsWorld.addBody(carBody);
  carMesh.position.set(0, 1.1, 0);
}

// ========== COLLISION HANDLER ==========
function handleCollision(evt) {
  console.log("Car collided with: ", evt.body);
  // Show collision overlay for a moment
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    // Hide after 1 second
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
}

// ========== JOYSTICK (Steering Only) ==========
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
  }, 300);

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

  // We only really care about the horizontal direction for steering
  joystickX = (clampedDist * Math.cos(angle)) / joystickMaxDistance;

  // Move the knob horizontally
  joystickKnob.style.transform = `translateX(${joystickX * joystickMaxDistance * 0.6}px)`;

  const deadZone = 0.2;
  moveLeft = joystickX < -deadZone;
  moveRight = joystickX > deadZone;
}

// ========== BUTTONS (Accelerate + Brake) ==========
function initButtons() {
  accelerateButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  if (accelerateButton) {
    accelerateButton.addEventListener("mousedown", () => {
      accelerateInput = true;
    });
    accelerateButton.addEventListener("mouseup", () => {
      accelerateInput = false;
    });
    // For touch
    accelerateButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      accelerateInput = true;
    }, { passive: false });
    accelerateButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      accelerateInput = false;
    }, { passive: false });
  }

  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => {
      brakeInput = true;
    });
    brakeButton.addEventListener("mouseup", () => {
      brakeInput = false;
    });
    // For touch
    brakeButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      brakeInput = true;
    }, { passive: false });
    brakeButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      brakeInput = false;
    }, { passive: false });
  }
}

// ========== ANIMATION LOOP ==========
function animate() {
  animationId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - previousTime) / 1000;
  previousTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacleMeshes(); // sync obstacle mesh positions (if they are dynamic)
  renderer.render(scene, camera);
}

// If obstacles are dynamic, you can sync them here
// Currently they are static, so no changes. Left for completeness.
function updateObstacleMeshes() {
  for (let i = 0; i < obstacles.length; i++) {
    obstacles[i].position.copy(obstacleBodies[i].position);
    obstacles[i].quaternion.copy(obstacleBodies[i].quaternion);
  }
}

// ========== CAR LOGIC (Real-Car) ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  let vx = carBody.velocity.x;
  let vz = carBody.velocity.z;
  let speed = vz; // Our "forward" direction is +Z

  // 1) ACCELERATE
  if (accelerateInput) {
    speed += ENGINE_FORCE * dt;
    if (speed > MAX_FORWARD_SPEED) speed = MAX_FORWARD_SPEED;
  }
  // 2) BRAKE / REVERSE
  else if (brakeInput) {
    speed -= BRAKE_FORCE * dt;
    if (speed < -MAX_REVERSE_SPEED) speed = -MAX_REVERSE_SPEED;
  }
  // 3) No input => approach idle speed
  else {
    const diff = speed - idleSpeed;
    const brakeFactor = 2; 
    if (diff > 0) {
      speed -= brakeFactor * dt;
      if (speed < idleSpeed) speed = idleSpeed;
    } else if (diff < 0) {
      speed += brakeFactor * dt;
      if (speed > idleSpeed) speed = idleSpeed;
    }
  }

  // Steering from joystick
  let sideSpeed = vx;
  if (moveLeft) {
    sideSpeed = -5;
  } else if (moveRight) {
    sideSpeed = 5;
  } else {
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

// ========== BOOTSTRAP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
