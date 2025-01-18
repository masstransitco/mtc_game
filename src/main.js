/*****************************************************
 * main.js
 * - Ensures Car Sits on Ground using Bounding Box
 * - Steering Wheel Ring Design
 * - Applies Forces for Acceleration & Braking
 * - Displays RPM & Speed
 * - Adds Collision Feedback
 *****************************************************/

// ========== Imports (ES Modules) ==========
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import * as CANNON from "cannon-es";

// ========== GLOBALS ==========

// Basic
let scene, camera, renderer;
let physicsWorld;

// Car
let carMesh, carBody;

// Steering ring
let steeringBase, steeringKnob;
let steeringAngle = 0; // -1..+1

// Buttons
let accelButton, brakeButton;
let accelInput = false, brakeInput = false;

// UI
let collisionIndicator, speedIndicator, rpmIndicator;

// Driving constants
const ENGINE_FORCE = 1200;
const BRAKE_FORCE = 900;
const MAX_FWD_SPEED = 20;
const MAX_REV_SPEED = 5;
const STEER_RESPONSE = 2;
const STEER_MAX_ANGLE = Math.PI / 4;

// Orbit
let orbitAngle = 0;
let orbitActive = false;
let orbitBouncingBack = false;
let orbitAngleOnRelease = 0;
let orbitDragStartX = 0;
let orbitLerpStart = 0;
const orbitDistance = 10;
const orbitHeight = 5;

// Timing
let prevTime = 0;
let animId = null;

// ========== INIT ==========
function init() {
  initScene();
  initPhysics();
  initEnvironment();
  spawnObstacles();
  loadCarWithDraco();

  initSteering();
  initButtons();
  initCameraOrbit();

  // Start screen
  const startScreen = document.getElementById("start-screen");
  const playBtn = document.getElementById("play-button");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (startScreen) startScreen.style.display = "none";
    });
  }

  collisionIndicator = document.getElementById("collisionIndicator");
  speedIndicator = document.getElementById("speedIndicator");
  rpmIndicator = document.getElementById("rpmIndicator");

  prevTime = Date.now();
  animate();
}

// ========== SCENE ==========
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky Blue

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 5, 10); // Initial camera position

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, -10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  scene.add(directionalLight);

  // Optional: Add Axes Helper for Debugging
  // const axesHelper = new THREE.AxesHelper(5);
  // scene.add(axesHelper);

  window.addEventListener("resize", onResize, false);
}

function onResize() {
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
  physicsWorld.defaultContactMaterial.friction = 0.4;

  // Ground plane
  const groundBody = new CANNON.Body({ mass: 0 });
  const groundShape = new CANNON.Plane();
  groundBody.addShape(groundShape);
  // Rotate to make it horizontal
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);
}

// ========== ENVIRONMENT ========== 
function initEnvironment() {
  const groundSize = 200;
  const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 }); // Forest Green
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// Obstacles
let obstacles = [], obstacleBodies = [];
function spawnObstacles() {
  const positions = [
    { x: 0, z: 30 },
    { x: 2, z: 50 },
    { x: -3, z: 70 },
    { x: 5, z: 90 },
    { x: -5, z: 110 },
  ];
  for (let p of positions) {
    const size = 2;
    const boxGeometry = new THREE.BoxGeometry(size, size, size);
    const boxMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 }); // Gray
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    boxMesh.position.set(p.x, size / 2, p.z);
    scene.add(boxMesh);

    // Cannon Body
    const boxShape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const boxBody = new CANNON.Body({ mass: 0, shape: boxShape });
    boxBody.position.set(p.x, size / 2, p.z);
    physicsWorld.addBody(boxBody);

    obstacles.push(boxMesh);
    obstacleBodies.push(boxBody);
  }
}

// ========== LOAD CAR WITH DRACO ==========
function loadCarWithDraco() {
  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/"); // Ensure Draco decoder files are here
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    "/car1.glb", // Path to your Draco-compressed GLB
    (gltf) => {
      carMesh = gltf.scene;
      carMesh.scale.set(2, 2, 2);
      scene.add(carMesh);

      // Traverse to set shadows
      carMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Compute bounding box
      const bbox = new THREE.Box3().setFromObject(carMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      console.log("Car bounding size:", size);

      // Get minY to determine yOffset
      const minY = bbox.min.y;
      console.log("Car bounding minY:", minY);

      // Compute yOffset to align minY to 0
      const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
      const yOffset = halfExtents.y - minY;
      console.log("Computed yOffset:", yOffset);

      // Shift mesh to set minY to 0
      carMesh.position.y += yOffset;

      // Define Cannon shape based on bounding box size
      const shape = new CANNON.Box(halfExtents);

      // Create Cannon body
      carBody = new CANNON.Body({
        mass: 500, // Heavier mass for better physics
        shape: shape,
        position: new CANNON.Vec3(0, halfExtents.y, 0), // Place so bottom touches ground
        linearDamping: 0.2, // Reduces velocity over time
        angularDamping: 0.3, // Reduces rotation over time
      });

      // Lock X and Z rotation to prevent tipping
      carBody.angularFactor.set(0, 1, 0);

      // Add collision event listener
      carBody.addEventListener("collide", onCarCollision);

      // Add body to physics world
      physicsWorld.addBody(carBody);

      // Sync mesh with physics body
      carMesh.position.copy(carBody.position);
      carMesh.quaternion.copy(carBody.quaternion);

      // Rotate the car mesh to face +Z if necessary
      // Assume model faces -Z initially; rotate 180 degrees around Y-axis
      carMesh.rotation.y = Math.PI;
      carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
      carMesh.quaternion.copy(carBody.quaternion);

      console.log("Car loaded & positioned");
    },
    undefined,
    (error) => {
      console.error("Error loading Draco GLB:", error);
      createFallbackCar();
    }
  );
}

function createFallbackCar() {
  // Fallback if Draco loading fails
  const geom = new THREE.BoxGeometry(2, 1, 4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 }); // Red
  carMesh = new THREE.Mesh(geom, mat);
  scene.add(carMesh);

  // Compute bounding box
  const bbox = new THREE.Box3().setFromObject(carMesh);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const minY = bbox.min.y;
  console.log("Fallback Car bounding size:", size);
  console.log("Fallback Car bounding minY:", minY);

  // Compute yOffset to align minY to 0
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const yOffset = halfExtents.y - minY;
  console.log("Fallback Car Computed yOffset:", yOffset);

  // Shift mesh to set minY to 0
  carMesh.position.y += yOffset;

  // Define Cannon shape based on bounding box size
  const shape = new CANNON.Box(halfExtents);

  // Create Cannon body
  carBody = new CANNON.Body({
    mass: 500,
    shape: shape,
    position: new CANNON.Vec3(0, halfExtents.y, 0),
    linearDamping: 0.2,
    angularDamping: 0.3,
  });
  carBody.angularFactor.set(0, 1, 0);
  carBody.addEventListener("collide", onCarCollision);
  physicsWorld.addBody(carBody);

  // Sync mesh with physics body
  carMesh.position.copy(carBody.position);
  carMesh.quaternion.copy(carBody.quaternion);

  // Rotate the car mesh to face +Z if necessary
  // Assume model faces -Z initially; rotate 180 degrees around Y-axis
  carMesh.rotation.y = Math.PI;
  carBody.quaternion.setFromEuler(0, Math.PI, 0, "YXZ");
  carMesh.quaternion.copy(carBody.quaternion);

  console.log("Fallback Car loaded & positioned");
}

function onCarCollision(e) {
  // Display collision indicator
  if (collisionIndicator) {
    collisionIndicator.style.display = "block";
    collisionIndicator.textContent = "Collision!";
    setTimeout(() => {
      collisionIndicator.style.display = "none";
    }, 1000);
  }
  console.log("Car collided with body:", e.body.id);
}

// ========== STEERING ==========
function initSteering() {
  steeringBase = document.getElementById("joystick-base");
  steeringKnob = document.getElementById("joystick-knob");
  if (!steeringBase || !steeringKnob) return;

  // Event Listeners for Steering
  steeringBase.addEventListener("touchstart", onSteerStart, { passive: false });
  steeringBase.addEventListener("touchmove", onSteerMove, { passive: false });
  steeringBase.addEventListener("touchend", onSteerEnd, { passive: false });
  steeringBase.addEventListener("mousedown", onSteerStart, { passive: false });
  document.addEventListener("mousemove", onSteerMove, { passive: false });
  document.addEventListener("mouseup", onSteerEnd, { passive: false });
}

function onSteerStart(e) {
  e.preventDefault();
  steeringActive = true;
  steeringKnob.classList.add("active");
  updateSteer(e);
}

function onSteerMove(e) {
  if (!steeringActive) return;
  e.preventDefault();
  updateSteer(e);
}

function onSteerEnd(e) {
  if (!steeringActive) return;
  e.preventDefault();
  steeringActive = false;
  steeringKnob.classList.remove("active");

  // Animate knob back to center
  steeringKnob.style.transition = "transform 0.3s ease";
  steeringKnob.style.transform = "translate(-50%, -50%) rotate(0deg)";
  setTimeout(() => {
    steeringKnob.style.transition = "none";
    steeringAngle = 0;
  }, 300);
}

function updateSteer(e) {
  const rect = steeringBase.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;

  let angle = Math.atan2(dy, dx); // -π..π
  let angleDeg = THREE.MathUtils.radToDeg(angle);
  angleDeg = THREE.MathUtils.clamp(angleDeg, -180, 180);

  // Rotate the knob
  steeringKnob.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;

  // Normalize steering angle between -1 and +1
  steeringAngle = angleDeg / 180;
}

// ========== BUTTONS (GAS/BRAKE) ==========
function initButtons() {
  accelButton = document.getElementById("accelerateButton");
  brakeButton = document.getElementById("brakeButton");

  // Accelerate Button Event Listeners
  if (accelButton) {
    accelButton.addEventListener("mousedown", () => {
      accelInput = true;
      console.log("Gas pressed");
    });
    accelButton.addEventListener("mouseup", () => {
      accelInput = false;
      console.log("Gas released");
    });
    accelButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      accelInput = true;
      console.log("Gas pressed (touch)");
    }, { passive: false });
    accelButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      accelInput = false;
      console.log("Gas released (touch)");
    }, { passive: false });
  }

  // Brake Button Event Listeners
  if (brakeButton) {
    brakeButton.addEventListener("mousedown", () => {
      brakeInput = true;
      console.log("Brake pressed");
    });
    brakeButton.addEventListener("mouseup", () => {
      brakeInput = false;
      console.log("Brake released");
    });
    brakeButton.addEventListener("touchstart", (e) => {
      e.preventDefault();
      brakeInput = true;
      console.log("Brake pressed (touch)");
    }, { passive: false });
    brakeButton.addEventListener("touchend", (e) => {
      e.preventDefault();
      brakeInput = false;
      console.log("Brake released (touch)");
    }, { passive: false });
  }
}

// ========== ORBIT CAMERA ==========
function initCameraOrbit() {
  document.addEventListener("mousedown", orbitStart, false);
  document.addEventListener("touchstart", orbitStart, { passive: false });
}

function orbitStart(e) {
  const ignore = ["joystick-base", "joystick-knob", "accelerateButton", "brakeButton"];
  if (ignore.includes(e.target.id)) return;

  e.preventDefault();
  orbitActive = true;
  orbitBouncingBack = false;

  orbitDragStartX = e.clientX || (e.touches && e.touches[0].clientX);

  document.addEventListener("mousemove", orbitMove, false);
  document.addEventListener("touchmove", orbitMove, { passive: false });
  document.addEventListener("mouseup", orbitEnd, false);
  document.addEventListener("touchend", orbitEnd, { passive: false });
}

function orbitMove(e) {
  if (!orbitActive) return;
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const deltaX = clientX - orbitDragStartX;
  orbitDragStartX = clientX;
  orbitAngle += deltaX * -0.3 * (Math.PI / 180); // Sensitivity factor
}

function orbitEnd(e) {
  if (!orbitActive) return;
  orbitActive = false;

  document.removeEventListener("mousemove", orbitMove);
  document.removeEventListener("touchmove", orbitMove);
  document.removeEventListener("mouseup", orbitEnd);
  document.removeEventListener("touchend", orbitEnd);

  // Start bounce-back
  orbitAngleOnRelease = orbitAngle;
  orbitLerpStart = Date.now();
  orbitBouncingBack = true;
}

// ========== ANIMATION LOOP ==========
function animate() {
  animId = requestAnimationFrame(animate);

  const now = Date.now();
  const dt = (now - prevTime) / 1000; // delta time in seconds
  prevTime = now;

  physicsWorld.step(1 / 60, dt, 3);

  updateCarLogic(dt);
  updateObstacles();
  updateCamera(dt);

  renderer.render(scene, camera);
}

function updateObstacles() {
  // Static obstacles; no need to update positions
}

// ========== CAR LOGIC ==========
function updateCarLogic(dt) {
  if (!carBody) return;

  // 1. Steering: Adjust heading based on steering angle
  const currentHeading = getBodyYRot(carBody);
  const targetHeading = steeringAngle * STEER_MAX_ANGLE;
  const diff = targetHeading - currentHeading;
  const turn = THREE.MathUtils.clamp(diff, -STEER_RESPONSE * dt, STEER_RESPONSE * dt);
  const newHeading = currentHeading + turn;
  setBodyYRot(carBody, newHeading);

  // 2. Apply Forces for Acceleration & Braking
  // Define forward direction based on current heading
  // Invert forwardVec due to car rotation
  const forwardVec = new CANNON.Vec3(-Math.sin(newHeading), 0, -Math.cos(newHeading));

  // Calculate current speed along forward direction
  const vel = carBody.velocity.clone();
  const forwardSpeed = vel.dot(forwardVec);

  // Apply Engine Force
  if (accelInput) {
    if (forwardSpeed < MAX_FWD_SPEED) {
      const force = forwardVec.scale(ENGINE_FORCE);
      carBody.applyForce(force, carBody.position);
      console.log("Accelerating. Applied force:", force.toString());
    }
  }

  // Apply Brake Force
  if (brakeInput) {
    if (forwardSpeed > -MAX_REV_SPEED) {
      const brakeForce = forwardVec.scale(-BRAKE_FORCE);
      carBody.applyForce(brakeForce, carBody.position);
      console.log("Braking. Applied force:", brakeForce.toString());
    }
  }

  // 3. Limit Maximum Speed (optional)
  const speedLimit = 50; // m/s (~180 km/h)
  const currentSpeed = carBody.velocity.length();
  if (currentSpeed > speedLimit) {
    carBody.velocity.scale(speedLimit / currentSpeed, carBody.velocity);
  }

  // 4. Sync Three.js Mesh with Cannon.js Body
  if (carMesh) {
    carMesh.position.copy(carBody.position);
    carMesh.quaternion.copy(carBody.quaternion);
  }

  // 5. Update Speed and RPM Indicators
  updateSpeedAndRPM(forwardSpeed);
}

function updateSpeedAndRPM(forwardSpeed) {
  // Convert speed to km/h
  const speedKmh = Math.abs(forwardSpeed) * 3.6;
  if (speedIndicator) {
    speedIndicator.textContent = `Speed: ${speedKmh.toFixed(1)} km/h`;
  }

  // Simple RPM calculation
  let rpm = 800 + 200 * Math.abs(forwardSpeed); // Adjust factors as needed
  rpm = Math.floor(rpm);
  if (rpmIndicator) {
    rpmIndicator.textContent = `RPM: ${rpm}`;
  }
}

// ========== CAMERA UPDATE ==========
function updateCamera(dt) {
  if (!carBody) return;

  // Handle bounce-back if user has stopped orbiting
  if (!orbitActive && orbitBouncingBack) {
    const t = (Date.now() - orbitLerpStart) / 1000; // seconds elapsed
    const bounceDuration = 1; // seconds

    if (t >= bounceDuration) {
      orbitAngle = 0;
      orbitBouncingBack = false;
    } else {
      const ratio = 1 - Math.pow(1 - t / bounceDuration, 3); // Ease out
      orbitAngle = THREE.MathUtils.lerp(orbitAngleOnRelease, 0, ratio);
    }
  }

  // Calculate camera position based on orbit angle
  const heading = getBodyYRot(carBody);
  const baseAngle = heading + Math.PI; // Behind the car
  const camAngle = baseAngle + orbitAngle;

  const carPos = carBody.position;
  const camX = carPos.x + Math.sin(camAngle) * orbitDistance;
  const camZ = carPos.z + Math.cos(camAngle) * orbitDistance;
  const camY = carPos.y + orbitHeight;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(carPos.x, carPos.y, carPos.z);
}

// ========== HELPER FUNCTIONS ==========
function getBodyYRot(body) {
  const q = body.quaternion;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
    "YXZ"
  );
  return euler.y;
}

function setBodyYRot(body, yRad) {
  const euler = new THREE.Euler(0, yRad, 0, "YXZ");
  const quat = new THREE.Quaternion().setFromEuler(euler);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
}

// ========== STARTUP ==========
document.addEventListener("DOMContentLoaded", () => {
  init();
});
